<script setup lang="ts">
import type { ArchiveDataAdapter, ArchiveSkippedOwnerEntry } from './mount'
import type { SupportedLocale } from './i18n'
import ArrowLeftRight from 'lucide-vue-next/dist/esm/icons/arrow-left-right.js'
import CheckCircle2 from 'lucide-vue-next/dist/esm/icons/circle-check.js'
import ClipboardCheck from 'lucide-vue-next/dist/esm/icons/clipboard-check.js'
import Database from 'lucide-vue-next/dist/esm/icons/database.js'
import LoaderCircle from 'lucide-vue-next/dist/esm/icons/loader-circle.js'
import RefreshCw from 'lucide-vue-next/dist/esm/icons/refresh-cw.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ archiveAdapter: ArchiveDataAdapter; locale: SupportedLocale }>()
const emit = defineEmits<{ close: []; updated: [] }>()
const ru = computed(() => props.locale === 'ru')
const label = (ruText: string, enText: string) => ru.value ? ruText : enText
type Inventory = Awaited<ReturnType<NonNullable<ArchiveDataAdapter['getArchiveMigrationOverview']>>>
type Delta = Awaited<ReturnType<NonNullable<ArchiveDataAdapter['reconcileArchiveRecent']>>>
type Audit = Awaited<ReturnType<NonNullable<ArchiveDataAdapter['auditArchiveCoverage']>>>
const inventory = ref<Inventory>()
const loading = ref(true)
const closeButton = ref<HTMLButtonElement | null>(null)
const active = ref(false)
const error = ref('')
const report = ref<Delta>()
const audit = ref<Audit>()
const integrity = ref<Awaited<ReturnType<NonNullable<ArchiveDataAdapter['auditArchiveIntegrity']>>>>()
const canUndoBackup = ref(false)
const backupFile = ref<File | null>(null)
const backupApproved = ref(false)
const backupMessage = ref('')
const backupRestoreResult = ref<{ conversations: number; messages: number; snapshots: number }>()
function onBackupFile(event: Event) {
  backupFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
  backupApproved.value = false
  backupMessage.value = ''
}
function saveBackup() {
  if (!props.archiveAdapter.exportCanonicalBackup) return
  void work(async () => {
    backupMessage.value = ''
    const blob = await props.archiveAdapter.exportCanonicalBackup!()
    if (!blob.size) throw new Error('The canonical backup is empty')
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `booster-canonical-${new Date().toISOString().slice(0, 10)}.ndjson.gz`
      document.body.appendChild(a)
      a.click()
      a.remove()
      backupMessage.value = label('Копия подготовлена. Проверь, что браузер сохранил файл.',
        'Backup prepared. Verify the browser saved the file.')
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  })
}
function restoreBackupFile() {
  const file = backupFile.value
  if (!file || !backupApproved.value || !props.archiveAdapter.restoreCanonicalBackup) return
  void work(async () => {
    backupMessage.value = ''
    backupRestoreResult.value = await props.archiveAdapter.restoreCanonicalBackup!(file)
    backupApproved.value = false
    backupFile.value = null
    audit.value = undefined
    integrity.value = undefined
    emit('updated')
    await inspect()
  })
}
const integrityProblems = computed(() => integrity.value
  ? integrity.value.invalidSourceRecords + integrity.value.missingCanonicalRecords +
    integrity.value.mismatchedPreferredRecords + integrity.value.missingSnapshotRecords +
    integrity.value.changedSnapshotRecords + integrity.value.changedProjectionRecords
  : 0)
const ownerInspection = ref<{
  examined: number
  skippedMessages: number
  skippedConversations: readonly ArchiveSkippedOwnerEntry[]
  sinceMs: number
}>()
const ownerInspectionHours = ref<48 | 168>(48)
const lastReconcileHours = ref<48 | 168>(48)
const selectedLegacyIds = ref<string[]>([])
const skippedList = computed(() =>
  ownerInspection.value?.skippedConversations ?? report.value?.skippedConversations ?? [])
const selectedLegacyCount = computed(() => selectedLegacyIds.value.length)
const progress = ref({ conversations: 0, messages: 0, status: 'idle' })
const busy = computed(() => loading.value || active.value)
const unverified = computed(() => (inventory.value?.unboundConversations ?? 0) +
  (inventory.value?.conflictingConversations ?? 0))
// A sum of v3+v4 headers double-counts overlapping IDs and cannot be used
// as the number of missing chats. Only the account-scoped read-only audit can.
const missing = computed(() => audit.value?.conversationCountShortfall ?? null)
const isMigrationNeeded = computed(() => !inventory.value?.activeGeneration)
let unsubscribe: (() => void) | undefined
let alive = true
let requestId = 0

async function inspect() {
  if (!props.archiveAdapter.getArchiveMigrationOverview) {
    error.value = label('Проверка архива недоступна.', 'Archive inventory unavailable.')
    loading.value = false
    return
  }
  const id = ++requestId
  loading.value = true
  error.value = ''
  try {
    const [result, rollback] = await Promise.all([
      props.archiveAdapter.getArchiveMigrationOverview(),
      props.archiveAdapter.canUndoCanonicalBackupRestore?.() ?? Promise.resolve(false),
    ])
    if (alive && id === requestId) {
      inventory.value = result
      canUndoBackup.value = rollback
    }
  } catch (cause) {
    if (alive && id === requestId)
      error.value = cause instanceof Error ? cause.message : label('Не удалось проверить архив.', 'Archive check failed.')
  } finally {
    if (alive && id === requestId) loading.value = false
  }
}
async function work(fn: () => Promise<void>) {
  if (busy.value) return
  active.value = true
  error.value = ''
  try { await fn() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : label('Операция не выполнена.', 'Operation failed.') }
  finally { active.value = false }
}
function migrate() {
  if (!props.archiveAdapter.startArchiveMigration) return
  void work(async () => {
    await props.archiveAdapter.startArchiveMigration!(false)
    emit('updated')
    await inspect()
  })
}
function reconcile(hours: 48 | 168, approveSelected = false) {
  if (!props.archiveAdapter.reconcileArchiveRecent || (approveSelected && !selectedLegacyCount.value))
    return
  void work(async () => {
    lastReconcileHours.value = hours
    const approved = approveSelected ? [...selectedLegacyIds.value] : []
    report.value = await props.archiveAdapter.reconcileArchiveRecent!(hours, approved)
    selectedLegacyIds.value = []
    ownerInspection.value = undefined
    emit('updated')
    await inspect()
  })
}
function inspectAllSkipped() {
  if (!props.archiveAdapter.inspectSkippedOwnershipAll) return
  void work(async () => {
    selectedLegacyIds.value = []
    ownerInspection.value = await props.archiveAdapter.inspectSkippedOwnershipAll!()
    report.value = undefined
  })
}
function reconcileAll(approveSelected = false) {
  if (!props.archiveAdapter.reconcileArchiveAll || (approveSelected && !selectedLegacyCount.value)) return
  void work(async () => {
    report.value = await props.archiveAdapter.reconcileArchiveAll!(
      approveSelected ? [...selectedLegacyIds.value] : [],
    )
    selectedLegacyIds.value = []
    ownerInspection.value = undefined
    emit('updated')
    await inspect()
  })
}
function inspectSkipped(hours: 48 | 168) {
  if (!props.archiveAdapter.inspectSkippedOwnership) return
  void work(async () => {
    ownerInspectionHours.value = hours
    selectedLegacyIds.value = []
    ownerInspection.value = await props.archiveAdapter.inspectSkippedOwnership!(hours)
    report.value = undefined
  })
}
function verifyIntegrity() {
  if (!props.archiveAdapter.auditArchiveIntegrity) return
  void work(async () => { integrity.value = await props.archiveAdapter.auditArchiveIntegrity!() })
}
function verifyCounts() {
  if (!props.archiveAdapter.auditArchiveCoverage) return
  void work(async () => { audit.value = await props.archiveAdapter.auditArchiveCoverage!() })
}
function close() {
  if (!active.value) emit('close')
}

onMounted(() => {
  closeButton.value?.focus()
  unsubscribe = props.archiveAdapter.subscribeArchiveMigration?.(() => {
    const state = props.archiveAdapter.archiveMigrationProgress?.()
    if (state) progress.value = {
      status: state.status,
      conversations: state.conversations,
      messages: state.messages,
    }
  })
  void inspect()
})
onBeforeUnmount(() => { alive = false; ++requestId; unsubscribe?.() })
</script>

<template>
  <div class="booster-maintenance-backdrop" @click.self="close">
    <section class="booster-maintenance-widget" role="dialog" aria-modal="true"
      :aria-label="label('Управление архивом', 'Archive management')"
      @keydown.esc.stop.prevent="close">
      <header class="booster-maintenance-heading">
        <div class="booster-maintenance-title">
          <Database class="size-5" />
          <div>
            <h2>{{ label('Управление архивом', 'Archive management') }}</h2>
            <p>{{ label('Перенос и сверка локальных данных', 'Migration and local data reconciliation') }}</p>
          </div>
        </div>
        <button ref="closeButton" type="button" class="booster-icon-button"
          :disabled="active" :aria-label="label('Закрыть управление архивом', 'Close archive management')"
          @click="close"><X class="size-4" /></button>
      </header>

      <div class="booster-maintenance-content">
        <div v-if="loading" class="booster-maintenance-loading" role="status">
          <LoaderCircle class="size-4 booster-reader-spinner" />
          {{ label('Проверка локальных записей…', 'Inspecting local archive…') }}
        </div>
        <template v-else-if="inventory">
          <div class="booster-maintenance-stats">
            <div><span>{{ label('Исходные записи диалогов', 'Legacy chat headers') }}</span><strong>{{ inventory.legacyConversations }}</strong></div>
            <div><span>{{ label('Перенесено', 'Migrated') }}</span><strong>{{ inventory.migratedConversations }}</strong></div>
            <div><span>{{ label('Отсутствуют (после сверки)', 'Missing (after audit)') }}</span><strong>{{ missing ?? '—' }}</strong></div>
          </div>

          <section v-if="isMigrationNeeded" class="booster-maintenance-section">
            <div class="booster-maintenance-section-title">
              <ArrowLeftRight class="size-4" />
              <h3>{{ label('Первоначальный перенос', 'Initial migration') }}</h3>
            </div>
            <p>{{ label('Старые базы сохраняются. Перенос создаёт канонические записи без удаления источника.',
              'Original databases are retained. Migration creates canonical records without deleting the source.') }}</p>
            <p v-if="unverified" class="booster-maintenance-warning">
              {{ label(`Требуется подтверждение владельца: ${inventory.unboundConversations} без идентификатора, ${inventory.conflictingConversations} с отличающимся ID.`,
                `Owner confirmation required: ${inventory.unboundConversations} unknown, ${inventory.conflictingConversations} mismatched.`) }}
            </p>
            <button type="button" class="booster-action-primary" :disabled="busy"
              @click="migrate">{{ label('Перенести подтверждённые записи', 'Migrate verified records') }}</button>
          </section>

          <section v-if="inventory.activeGeneration" class="booster-maintenance-section">
            <div class="booster-maintenance-section-title">
              <RefreshCw class="size-4" />
              <h3>{{ label('Сверка изменений', 'Reconcile changes') }}</h3>
            </div>
            <p>{{ label('Не пересоздаёт старый архив. Проверяет недавние изменения старых вкладок и дополняет текущие записи.',
              'Does not rebuild the archive. Checks recent writes from older tabs and updates canonical records.') }}</p>
            <div class="booster-maintenance-actions">
              <button type="button" class="booster-action-primary" :disabled="busy" @click="reconcile(48)">
                {{ label('Быстрая сверка', 'Quick sync') }}
                <small>{{ label('После последнего переноса', 'Since last import') }}</small>
              </button>
              <button type="button" class="booster-action-secondary" :disabled="busy" @click="reconcile(168)">
                {{ label('За 7 дней', 'Last 7 days') }}
              </button>
            </div>
            <button type="button" class="booster-action-secondary" :disabled="busy || !archiveAdapter.reconcileArchiveAll"
              @click="reconcileAll(false)">{{ label('Сверить всю историю', 'Reconcile all history') }}</button>
            <button type="button" class="booster-action-secondary"
              :disabled="busy || !archiveAdapter.inspectSkippedOwnershipAll"
              @click="inspectAllSkipped">
              {{ label('Показать все пропущенные диалоги', 'Inspect all skipped chats') }}
            </button>
            <button v-if="ownerInspection?.skippedMessages" type="button"
              class="booster-maintenance-link" :disabled="busy" @click="inspectSkipped(168)">
              {{ label('Проверить также за 7 дней', 'Inspect last 7 days too') }}
            </button>
          </section>

          <section v-if="inventory.activeGeneration" class="booster-maintenance-section">
            <div class="booster-maintenance-section-title">
              <ClipboardCheck class="size-4" />
              <h3>{{ label('Контроль полноты', 'Coverage check') }}</h3>
            </div>
            <p>{{ label('Сравнение v3, v4 и canonical по диалогам. Счётчики не доказывают идентичность сообщений и полноту веток.',
              'Compares v3, v4 and canonical by chat. Counts do not prove message identity or branch completeness.') }}</p>
            <div class="booster-maintenance-actions">
              <button type="button" class="booster-action-secondary" :disabled="busy" @click="verifyCounts">
                {{ label('Сверить количество', 'Compare counts') }}
              </button>
              <button type="button" class="booster-action-secondary"
                :disabled="busy || !archiveAdapter.auditArchiveIntegrity" @click="verifyIntegrity">
                {{ label('Глубокая SHA-256 сверка', 'Deep SHA-256 audit') }}
              </button>
            </div>
            <p class="booster-note">{{ label('Глубокая проверка читает исходные сообщения и проверяет их сохранённые копии. Для больших архивов может потребоваться длительная обработка, без изменения записей.',
              'Deep audit verifies saved source contents and fingerprints. Large archives can take time; records are never modified.') }}</p>
          </section>

          <section class="booster-maintenance-section">
            <details class="booster-maintenance-backup-tools">
              <summary>{{ label('Резервная копия и восстановление', 'Backup and restore') }}</summary>
              <p>{{ label('Создаёт проверяемую сжатую копию только активных канонических записей. Исходные базы v3/v4 и непривязанные диалоги в этот файл не входят.',
                'Creates a verifiable compressed copy of the active canonical generation only. Original v3/v4 stores and unbound chats are not included.') }}</p>
              <button type="button" class="booster-action-secondary" :disabled="busy || !inventory.activeGeneration || !archiveAdapter.exportCanonicalBackup"
                @click="saveBackup">{{ label('Сохранить копию .ndjson.gz', 'Save .ndjson.gz backup') }}</button>
              <div class="booster-maintenance-backup-restore">
                <label>{{ label('Файл восстановимой копии', 'Restorable backup file') }}
                  <input type="file" accept=".gz,.ndjson.gz,application/gzip"
                    :disabled="busy" @change="onBackupFile" />
                </label>
                <label class="booster-maintenance-check">
                  <input v-model="backupApproved" type="checkbox" :disabled="busy || !backupFile" />
                  {{ label('Подтверждаю импорт в новое поколение текущего аккаунта. Существующий архив, если есть, останется сохранённым.',
                    'I approve importing this backup into a new generation of the current account. Any existing generation will be retained.') }}
                </label>
                <button type="button" class="booster-action-secondary"
                  :disabled="busy || !backupApproved || !backupFile || !archiveAdapter.restoreCanonicalBackup"
                  @click="restoreBackupFile">{{ label('Проверить и восстановить', 'Verify and restore') }}</button>
              </div>
              <p v-if="backupMessage" role="status" class="booster-maintenance-result">{{ backupMessage }}</p>
              <p v-if="backupRestoreResult" role="status" class="booster-maintenance-result">
                {{ label('Восстановлено', 'Restored') }}: {{ backupRestoreResult.conversations }} {{ label('диалогов', 'chats') }},
                {{ backupRestoreResult.messages }} {{ label('сообщений', 'messages') }},
                {{ backupRestoreResult.snapshots }} SourceSnapshots.
              </p>
            </details>
          </section>

          <section v-if="skippedList.length" class="booster-maintenance-section">
            <div class="booster-maintenance-section-title">
              <ClipboardCheck class="size-4" />
              <h3>{{ label('Неопределённый владелец', 'Unverified owners') }}</h3>
            </div>
            <p>{{ label(
              'Эти сообщения остались в исходной базе. Выбери только те диалоги, которые действительно принадлежат текущему аккаунту.',
              'These messages remain in the original database. Select only chats that belong to your current account.',
            ) }}</p>
            <div class="booster-maintenance-owner-list">
              <label v-for="chat in skippedList" :key="chat.conversationId"
                class="booster-maintenance-owner-row">
                <input v-model="selectedLegacyIds" type="checkbox"
                  :disabled="busy" :value="chat.conversationId" />
                <span class="booster-maintenance-owner-description">
                  <strong>{{ chat.title || label('Без названия', 'Untitled') }}</strong>
                  <span>{{ chat.messages }} {{ label('сообщений', 'messages') }} ·
                    {{ chat.reason === 'missing_owner'
                      ? label('владелец не записан', 'owner missing')
                      : label('ID владельца отличается', 'different owner ID') }}</span>
                  <details v-if="chat.messageIds.length" @click.stop>
                    <summary>{{ label('Примеры ID сообщений', 'Sample message IDs') }}</summary>
                    <code v-for="id in chat.messageIds" :key="id">{{ id }}</code>
                    <small v-if="chat.messages > chat.messageIds.length">{{ label(
                      'Показаны только первые 10 идентификаторов.',
                      'Only the first 10 identifiers are shown.',
                    ) }}</small>
                  </details>
                </span>
              </label>
            </div>
            <button type="button" class="booster-action-primary"
              :disabled="busy || !selectedLegacyCount"
              @click="reconcileAll(true)">
              {{ label(`Привязать выбранные (${selectedLegacyCount})`,
                `Bind selected (${selectedLegacyCount})`) }}
            </button>
            <p class="booster-maintenance-owner-caution">
              {{ label('Привязка сохраняет accountId только в каноническом архиве. Исходный raw.owner не изменяется.',
                'The canonical archive receives accountId. Original raw.owner is unchanged.') }}
            </p>
          </section>
          <p v-if="ownerInspection && !ownerInspection.skippedMessages"
            class="booster-maintenance-result" role="status">
            {{ label(ownerInspection.sinceMs === 0 ? 'Не найдено пропущенных по владельцу диалогов.' : 'В выбранном периоде пропусков нет.',
              ownerInspection.sinceMs === 0 ? 'No skipped-owner chats found.' : 'No skips in this period.') }}
          </p>
          <div v-if="active" role="status" class="booster-maintenance-progress">
            <LoaderCircle class="size-4 booster-reader-spinner" />
            <div>
              <strong>{{ label('Обработка архива…', 'Processing archive…') }}</strong>
              <p>{{ label('Диалогов', 'Chats') }}: {{ progress.conversations }} ·
                {{ label('Сообщений', 'Messages') }}: {{ progress.messages }}</p>
            </div>
          </div>
          <div v-if="report" class="booster-maintenance-result" role="status">
            <CheckCircle2 class="size-4" />
            <div>
              <strong>{{ label('Сверка завершена', 'Reconciliation complete') }}</strong>
              <p>{{ label('Проверено', 'Checked') }} {{ report.examined }} ·
                {{ label('Добавлено', 'Added') }} {{ report.inserted }} ·
                {{ label('Изменено', 'Updated') }} {{ report.changed }} ·
                {{ label('Без изменений', 'Unchanged') }} {{ report.unchanged }}</p>
              <p v-if="report.skippedOwnership">{{ label('Пропущено из-за владельца', 'Skipped by ownership') }}:
                {{ report.skippedOwnership }} · {{ label('детали ниже', 'details below') }}</p>
            </div>
          </div>
          <div v-if="integrity" class="booster-maintenance-result" role="status">
            <ClipboardCheck class="size-4" />
            <div>
              <strong>{{ label('Сверка содержимого', 'Content integrity audit') }}</strong>
              <p>{{ label('Проверено по SHA-256', 'SHA-256 compared') }}: {{ integrity.verifiedSourceRecords }} / {{ integrity.sourceRecords }} ·
                {{ label('Отложено из-за владельца', 'Awaiting ownership') }}: {{ integrity.quarantinedSourceRecords }} ·
                {{ label('Расхождения', 'Mismatches') }}: {{ integrityProblems }}</p>
              <p class="booster-note">{{ label('Хеши не подтверждают полноту серверных страниц и веток. Исходная БД остаётся без изменений.',
                'Hashes do not establish completeness of server pages and branches. Source databases are unchanged.') }}</p>
              <div v-if="integrity.issues.length" class="booster-maintenance-owner-list">
                <div v-for="entry in integrity.issues" :key="entry.conversationId + ':' + entry.source + ':' + entry.reason"
                  class="booster-maintenance-owner-row">
                  <span class="booster-maintenance-owner-description">
                    <strong>{{ entry.title || label('Без названия', 'Untitled') }}</strong>
                    <span>{{ entry.source }} · {{ entry.reason }} · {{ entry.messages }}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div v-if="audit" class="booster-maintenance-result" role="status">
            <ClipboardCheck class="size-4" />
            <div>
              <strong>{{ label('Счётчики проверены', 'Counts checked') }}</strong>
              <p>{{ label('Диалоги: исходные / новые', 'Chats: old / new') }} —
                {{ audit.legacyConversations }} / {{ audit.canonicalConversations }}</p>
              <p>{{ label('Недостающие диалоги', 'Missing chats') }}: {{ audit.conversationCountShortfall }} ·
                {{ label('Диалоги с меньшим числом сообщений', 'Chats with fewer messages') }}: {{ audit.conversationsWithMessageShortfall }}</p>
              <div v-if="audit.missingDetails.length" class="booster-maintenance-owner-list">
                <div v-for="entry in audit.missingDetails" :key="entry.conversationId" class="booster-maintenance-owner-row">
                  <span class="booster-maintenance-owner-description">
                    <strong>{{ entry.title || label('Без названия', 'Untitled') }}</strong>
                    <span>v3: {{ entry.v3Count }} · v4: {{ entry.v4Count }} · canonical: {{ entry.canonicalCount }}</span>
                    <small v-if="entry.ownerStatus === 'mismatch' || entry.ownerStatus === 'waiting_for_owner'">
                      {{ label('Требуется проверка владельца', 'Owner verification required') }}
                    </small>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </template>
        <p v-if="error" class="booster-maintenance-error" role="alert">{{ error }}</p>
      </div>
      <footer class="booster-maintenance-footer">
        <button type="button" class="booster-action-secondary" :disabled="busy" @click="inspect">
          <RefreshCw class="size-4" />{{ label('Обновить', 'Refresh') }}
        </button>
        <button type="button" class="booster-action-secondary" :disabled="active" @click="close">
          {{ label('Закрыть', 'Close') }}
        </button>
      </footer>
    </section>
  </div>
</template>
