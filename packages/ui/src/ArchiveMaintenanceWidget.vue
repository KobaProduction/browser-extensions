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
const consentLegacy = ref(false)
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
const missing = computed(() => Math.max(0,
  (inventory.value?.legacyConversations ?? 0) - (inventory.value?.migratedConversations ?? 0)))
const isMigrationNeeded = computed(() => missing.value > 0)
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
    const result = await props.archiveAdapter.getArchiveMigrationOverview()
    if (alive && id === requestId) inventory.value = result
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
  if (!props.archiveAdapter.startArchiveMigration || (unverified.value > 0 && !consentLegacy.value)) return
  void work(async () => {
    await props.archiveAdapter.startArchiveMigration!(consentLegacy.value)
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
function inspectSkipped(hours: 48 | 168) {
  if (!props.archiveAdapter.inspectSkippedOwnership) return
  void work(async () => {
    ownerInspectionHours.value = hours
    selectedLegacyIds.value = []
    ownerInspection.value = await props.archiveAdapter.inspectSkippedOwnership!(hours)
    report.value = undefined
  })
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
            <div><span>{{ label('Исходные диалоги', 'Legacy chats') }}</span><strong>{{ inventory.legacyConversations }}</strong></div>
            <div><span>{{ label('Перенесено', 'Migrated') }}</span><strong>{{ inventory.migratedConversations }}</strong></div>
            <div><span>{{ label('Осталось проверить', 'To reconcile') }}</span><strong>{{ missing }}</strong></div>
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
            <label v-if="unverified" class="booster-maintenance-check">
              <input v-model="consentLegacy" type="checkbox" :disabled="busy" />
              <span>{{ label('Подтверждаю, что старые локальные диалоги относятся к моему текущему аккаунту.',
                'I confirm these legacy local chats belong to my current account.') }}</span>
            </label>
            <button type="button" class="booster-action-primary" :disabled="busy || (unverified > 0 && !consentLegacy)"
              @click="migrate">{{ label('Перенести оставшиеся записи', 'Migrate remaining records') }}</button>
          </section>

          <section v-if="inventory.migratedConversations > 0" class="booster-maintenance-section">
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
            <button type="button" class="booster-action-secondary"
              :disabled="busy || !archiveAdapter.inspectSkippedOwnership"
              @click="inspectSkipped(48)">
              {{ label('Показать пропущенные диалоги', 'Inspect skipped chats') }}
            </button>
            <button v-if="ownerInspection?.skippedMessages" type="button"
              class="booster-maintenance-link" :disabled="busy" @click="inspectSkipped(168)">
              {{ label('Проверить также за 7 дней', 'Inspect last 7 days too') }}
            </button>
          </section>

          <section v-if="inventory.migratedConversations > 0" class="booster-maintenance-section">
            <div class="booster-maintenance-section-title">
              <ClipboardCheck class="size-4" />
              <h3>{{ label('Контроль полноты', 'Coverage check') }}</h3>
            </div>
            <p>{{ label('Сравнение количества диалогов и сообщений. Не проверяет побайтовую идентичность.',
              'Compares conversation and message counts, not byte-level equivalence.') }}</p>
            <button type="button" class="booster-action-secondary" :disabled="busy" @click="verifyCounts">
              {{ label('Проверить счётчики', 'Compare counts') }}
            </button>
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
              @click="reconcile(ownerInspection ? ownerInspectionHours : lastReconcileHours, true)">
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
            {{ label('В выбранном периоде пропущенных по владельцу сообщений нет.',
              'No messages skipped by ownership in this period.') }}
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
          <div v-if="audit" class="booster-maintenance-result" role="status">
            <ClipboardCheck class="size-4" />
            <div>
              <strong>{{ label('Счётчики проверены', 'Counts checked') }}</strong>
              <p>{{ label('Диалоги: исходные / новые', 'Chats: old / new') }} —
                {{ audit.legacyConversations }} / {{ audit.canonicalConversations }}</p>
              <p>{{ label('Недостающие диалоги', 'Missing chats') }}: {{ audit.conversationCountShortfall }} ·
                {{ label('Диалоги с меньшим числом сообщений', 'Chats with fewer messages') }}: {{ audit.conversationsWithMessageShortfall }}</p>
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
