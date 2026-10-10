<script setup lang="ts">
import { Badge, Button } from '@kobaproduction/browser-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { CaptureProgress, FolderAudit, VkConversation, VkMessage } from '../model/types'
import { vkArchiveRuntime } from '../native-runtime'

const runtime = vkArchiveRuntime()
const chats = ref<VkConversation[]>([])
const peer = ref<number | null>(null)
const rows = ref<VkMessage[]>([])
const query = ref('')
const tab = ref<'archive' | 'export' | 'backups'>('archive')
const busy = ref(false)
const message = ref('')
const error = ref('')
const progress = ref<CaptureProgress | null>(null)
const from = ref('')
const through = ref('')
const includeText = ref(true)
const includeFiles = ref(false)
const extensions = ref('')
const fileSizeMB = ref(64)
const telemetryEnabled = ref(runtime?.telemetry.isEnabled() ?? false)
const audit = ref<FolderAudit | null>(null)
let poll: ReturnType<typeof setInterval> | null = null

const selected = computed(() => chats.value.find((c) => c.peerId === peer.value))
const filtered = computed(() =>
  rows.value.filter(
    (r) =>
      (!from.value || new Date(r.date * 1000).toISOString().slice(0, 10) >= from.value) &&
      (!through.value || new Date(r.date * 1000).toISOString().slice(0, 10) <= through.value) &&
      (!query.value || r.text.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())),
  ),
)
const visible = computed(() => filtered.value.slice(-220))
async function refresh() {
  if (!runtime) return
  chats.value = await runtime.repository.listConversations()
  const current = runtime.currentPeer()
  if (peer.value === null && current) peer.value = current
  if (peer.value) rows.value = await runtime.repository.listMessages(peer.value)
}
async function switchChat(id: number) {
  peer.value = id
  rows.value = (await runtime?.repository.listMessages(id)) ?? []
  audit.value = null
}
async function run<T>(task: () => Promise<T>, complete: (result: T) => string) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await task()
    message.value = complete(result)
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
function collect() {
  const id = peer.value
  if (!runtime || !id) return
  void run(
    () => runtime.collect(id, (p) => (progress.value = p)),
    (r) =>
      r.pages === 0
        ? 'Полный архив уже сохранён. Повторное сканирование не требуется.'
        : 'Переписка сохранена полностью: ' + r.stored + ' сообщений.',
  )
}
function exportFiles() {
  if (!runtime || !peer.value) return
  void run(
    async () => {
      if (!('showDirectoryPicker' in window))
        throw Error('Для экспорта нужна поддержка выбора папки в браузере')
      const folder = await window.showDirectoryPicker({ mode: 'readwrite' })
      return runtime.export(id, folder, {
        from: from.value,
        through: through.value,
        includeText: includeText.value,
        includeFiles: includeFiles.value,
        types: extensions.value.split(/[\s,;]+/).filter(Boolean),
        maxBytes: Math.max(1, Math.round(fileSizeMB.value * 1048576)),
      })
    },
    (r) => 'Экспортировано ' + r.messages + ' сообщений, файлов сохранено: ' + r.files + '.',
  )
}
function inspectFolder() {
  if (!runtime || !peer.value) return
  void run(
    async () => {
      const folder = await window.showDirectoryPicker({ mode: 'read' })
      audit.value = await runtime.audit(id, folder)
      return audit.value
    },
    (r) =>
      'Проверено: ' +
      r.ok.length +
      ' файлов, отсутствуют: ' +
      r.missing.length +
      ', переименованы: ' +
      r.renamed.length +
      ', изменены: ' +
      r.modified.length,
  )
}
function toggleTelemetry() {
  if (!runtime) return
  runtime.telemetry.setEnabled(!telemetryEnabled.value)
  telemetryEnabled.value = runtime.telemetry.isEnabled()
}
function download(data: Blob, name: string) {
  const href = URL.createObjectURL(data)
  const element = document.createElement('a')
  element.href = href
  element.download = name
  element.click()
  setTimeout(() => URL.revokeObjectURL(href), 60000)
}
function backup() {
  if (!runtime) return
  void run(
    () => runtime.backup(),
    (blob) => {
      download(blob, 'VK-archive-' + runtime.scope + '.json')
      return 'Резервная копия базы сохранена.'
    },
  )
}
async function restore(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!runtime || !file) return
  await run(
    async () => {
      const snapshot: unknown = JSON.parse(await file.text())
      await runtime.restore(snapshot as Parameters<typeof runtime.restore>[0])
      await refresh()
      return true
    },
    () => 'Архив восстановлен в текущей среде.',
  )
  input.value = ''
}
onMounted(() => {
  void refresh()
  poll = setInterval(() => {
    const current = runtime?.currentPeer()
    if (!busy.value && current && current !== peer.value) void switchChat(current)
  }, 1500)
})
onUnmounted(() => {
  if (poll) clearInterval(poll)
})
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 class="text-base font-bold">VK Archive</h2>
        <p class="text-xs text-muted-foreground">Локальная IndexedDB · {{runtime?.scope}} · без скачивания вложений</p>
      </div>
      <Badge variant="outline">{{ chats.length }} диалогов</Badge>
    </header>
    <nav class="flex flex-wrap gap-2" aria-label="Разделы VK Archive">
      <Button size="sm" :variant="tab==='archive'?'default':'outline'" @click="tab='archive'">Архив</Button>
      <Button size="sm" :variant="tab==='export'?'default':'outline'" @click="tab='export'">Экспорт и файлы</Button>
      <Button size="sm" :variant="tab==='backups'?'default':'outline'" @click="tab='backups'">База и резервные копии</Button>
    </nav>
    <div class="booster-stack-card space-y-3">
      <label class="booster-field">
        Диалог
        <select :value="peer??''" class="booster-select w-full" @change="switchChat(Number(($event.target as HTMLSelectElement).value))">
          <option value="" disabled>Выбери диалог</option>
          <option v-if="runtime?.currentPeer()&&!chats.some(c=>c.peerId===runtime?.currentPeer())" :value="runtime.currentPeer()">
            Открытый диалог {{runtime.currentPeer()}}
          </option>
          <option v-for="c in chats" :key="c.peerId" :value="c.peerId">Диалог {{c.peerId}} · {{c.messageCount}} сообщений{{c.complete?' · полностью':''}}</option>
        </select>
      </label>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-muted-foreground">
          {{selected?.complete?'Архив собран полностью':'Архив ещё не загружен полностью'}}
        </span>
        <Button :disabled="busy||!peer||Boolean(selected?.complete)||runtime?.currentPeer()!==peer" @click="collect">Собрать всю переписку</Button>
      </div>
      <p v-if="progress" class="text-xs" role="status">Страниц: {{progress.pages}} · Сообщений: {{progress.seen}} · {{progress.complete?'Готово':'Загрузка'}}</p>
    </div>
    <template v-if="tab==='archive'">
      <section class="booster-stack-card space-y-3" aria-label="Просмотр локальной переписки">
        <input v-model="query" class="booster-input w-full" type="search" placeholder="Поиск по сохранённым сообщениям" />
        <div class="max-h-[430px] space-y-2 overflow-y-auto rounded-lg border border-border bg-background p-3">
          <article v-for="r in visible" :key="r.id" class="max-w-[94%] rounded-xl border border-border p-3 text-sm"
            :class="r.out?'ml-auto bg-secondary':'mr-auto bg-card'">
            <div class="mb-1 flex justify-between gap-4 text-xs text-muted-foreground">
              <b>{{r.out?'Вы':'ID '+(r.fromId??'—')}}</b>
              <time>{{new Date(r.date*1000).toLocaleString('ru-RU')}}</time>
            </div>
            <p class="whitespace-pre-wrap break-words">{{r.text||'Сообщение без текста'}}</p>
            <p v-if="r.attachments.length" class="mt-2 text-xs text-muted-foreground">
              Вложения: {{r.attachments.map(a=>a.type).join(', ')}}
            </p>
          </article>
          <p v-if="!visible.length" class="text-sm text-muted-foreground">Сначала собери переписку через VK API.</p>
        </div>
        <p class="text-xs text-muted-foreground">Найдено: {{filtered.length}} · показаны последние {{visible.length}}</p>
      </section>
    </template>
    <template v-else-if="tab==='export'">
      <section class="booster-stack-card space-y-3">
        <b>Отдельный экспорт из сохранённого архива</b>
        <div class="grid grid-cols-2 gap-3">
          <label class="booster-field">С даты<input v-model="from" class="booster-input" type="date"/></label>
          <label class="booster-field">По дату<input v-model="through" class="booster-input" type="date"/></label>
        </div>
        <label class="flex gap-2 text-sm"><input v-model="includeText" type="checkbox"/> Содержимое сообщений</label>
        <label class="flex gap-2 text-sm"><input v-model="includeFiles" type="checkbox"/> Скачать файлы отдельно</label>
        <label v-if="includeFiles" class="booster-field">Типы или расширения (.jpg, .pdf, photo, doc)
          <input v-model="extensions" class="booster-input w-full" placeholder="Пусто — все типы"/>
        </label>
        <label v-if="includeFiles" class="booster-field">Максимум МБ на файл
          <input v-model.number="fileSizeMB" class="booster-input" type="number" min="1" max="64"/>
        </label>
        <p class="text-xs text-muted-foreground">Выход: chat.json, manifest.json и плоская папка attachments/ с числовыми префиксами файлов.</p>
        <div class="flex flex-wrap gap-2">
          <Button :disabled="busy||!selected?.complete" @click="exportFiles">Экспортировать в папку</Button>
          <Button variant="outline" :disabled="busy||!peer" @click="inspectFolder">Проверить ранее скачанные файлы</Button>
        </div>
        <p v-if="audit" class="text-xs">Есть: {{audit.ok.length}} · Утеряно: {{audit.missing.length}} · Переименовано: {{audit.renamed.length}} · Изменено: {{audit.modified.length}}</p>
      </section>
    </template>
    <template v-else>
      <section class="booster-stack-card space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <b>Телеметрия · VK Booster Service</b>
          <Button size="sm" variant="outline" :disabled="!runtime?.telemetry.available()" @click="toggleTelemetry">
            {{telemetryEnabled?'Отключить':'Включить'}}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">Только счётчики и длительности, отдельно для {{runtime?.scope}}.
          {{runtime?.telemetry.available()?'Транспорт подключён.':'Транспорт не подключён.'}}
        </p>
        <b>Резервное копирование IndexedDB</b>
        <p class="text-sm text-muted-foreground">База принадлежит только {{runtime?.scope}}. Бэкап не содержит токенов и файлов вложений.</p>
        <div class="flex flex-wrap gap-2">
          <Button :disabled="busy" @click="backup">Скачать резервную копию JSON</Button>
          <label class="booster-button cursor-pointer">
            Восстановить JSON
            <input type="file" accept=".json,application/json" class="sr-only" :disabled="busy" @change="restore"/>
          </label>
        </div>
        <p class="text-xs text-muted-foreground">Восстановление проверяет схему и среду, затем атомарно заменяет записи только этой базы.</p>
      </section>
    </template>
    <p v-if="message" role="status" class="text-sm">{{message}}</p>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{error}}</p>
  </div>
</template>
