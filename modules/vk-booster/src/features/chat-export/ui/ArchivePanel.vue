<script setup lang="ts">
/** FSD feature view. All export state stays in the model; no secondary overlay. */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { FolderOpen, Download, Pause, Play, Settings2, Archive } from 'lucide-vue-next'
import { Button, Badge, ArchiveProgress } from '@kobaproduction/browser-ui'
import { archiveApi, type ArchiveMode, type ArchiveStatus } from '../model/types'

const api=archiveApi()
const status=ref<ArchiveStatus|null>(api?.status()??null)
const mode=ref<ArchiveMode>(status.value?.options.mode??'recent')
const limit=ref(status.value?.options.limit??10)
const from=ref(status.value?.options.from??'')
const through=ref(status.value?.options.through??'')
const pageSize=ref(status.value?.options.pageSize??50)
const delay=ref(status.value?.options.delay??450)
const media=ref(status.value?.options.media??true)
const error=ref('')
const advanced=ref(false)
const progress=computed(()=>status.value?.progress)
const paused=computed(()=>status.value?.checkpoint?.status==='paused')
const available=computed(()=>Boolean(status.value?.folder))
let unsubscribe:(()=>void)|undefined

onMounted(()=>{
  unsubscribe=api?.subscribe(next=>{status.value=next})
})
onUnmounted(()=>unsubscribe?.())

async function pickFolder(){
  error.value=''
  try {await api?.selectFolder()} catch(e) {error.value=e instanceof Error?e.message:String(e)}
}
async function start(){
  error.value=''
  try{
    await api?.run({mode:mode.value,limit:Number(limit.value),from:from.value,through:through.value,
      pageSize:Number(pageSize.value),delay:Number(delay.value),media:media.value})
  }catch(e){error.value=e instanceof Error?e.message:String(e)}
}
async function resume(){
  error.value=''
  try{await api?.resume()}catch(e){error.value=e instanceof Error?e.message:String(e)}
}
</script>

<template>
  <template v-if="status">
    <section class="booster-setting-card">
      <div class="booster-setting-copy">
        <div class="flex items-center gap-2">
          <Archive class="size-4"/><b>Архив переписки VK</b>
          <Badge :variant="status.busy?'default':'outline'">{{status.busy?'Экспорт':'Ожидание'}}</Badge>
        </div>
        <span>Диалог {{status.options.peerId || 'не выбран'}} · Сообщений в архиве: {{status.messages}}</span>
      </div>
      <Button variant="outline" size="sm" :disabled="status.busy" @click="pickFolder">
        <FolderOpen class="size-4"/>Папка
      </Button>
    </section>

    <section class="booster-setting-card">
      <div class="booster-setting-copy">
        <b>Хранилище</b>
        <span>{{status.folder || 'Выбери папку архива'}}</span>
      </div>
    </section>

    <section class="booster-stack-card">
      <div class="booster-setting-copy"><b>Что выгружать</b><span>Без дублирования уже сохранённых сообщений</span></div>
      <div class="grid grid-cols-2 gap-3">
        <label class="booster-field">
          Режим
          <select v-model="mode" class="booster-select w-full">
            <option value="recent">Последние N</option>
            <option value="incremental">Только новые</option>
            <option value="backfill">Продолжить старые</option>
          </select>
        </label>
        <label class="booster-field">
          Количество сообщений
          <input v-model.number="limit" class="booster-input" type="number" min="1" max="100000" />
        </label>
      </div>
      <button class="booster-disclosure" type="button" :aria-expanded="advanced" @click="advanced=!advanced">
        <span><b>Дополнительные настройки</b><small>Диапазон дат, пачка и медиафайлы</small></span>
        <Settings2 class="size-4"/>
      </button>
      <div v-if="advanced" class="grid grid-cols-2 gap-3">
        <label class="booster-field">С даты<input v-model="from" class="booster-input" type="date"/></label>
        <label class="booster-field">По дату<input v-model="through" class="booster-input" type="date"/></label>
        <label class="booster-field">Пачка<input v-model.number="pageSize" class="booster-input" type="number" min="1" max="100"/></label>
        <label class="booster-field">Пауза, мс<input v-model.number="delay" class="booster-input" type="number" min="300"/></label>
        <label class="booster-field col-span-2"><span class="flex items-center gap-2"><input v-model="media" type="checkbox"/>Сохранять файлы и голосовые</span></label>
      </div>
    </section>

    <section class="booster-stack-card">
      <div class="booster-setting-copy"><b>Прогресс экспорта</b></div>
      <ArchiveProgress :label="progress?.phase || 'Ожидание'" aria-label="Прогресс экспорта"
        :busy="status.busy" :completed="progress?.phase === 'Готово' ? progress?.total : progress?.done"
        :total="progress?.total" :error="progress?.error" />
      <div class="booster-counter-grid text-xs">
        <span>Обработано <b>{{progress?.done??0}} / {{progress?.total??0}}</b></span>
        <span>Новых <b>{{progress?.newCount??0}}</b></span>
        <span>Файлов <b>{{progress?.downloaded??0}}</b></span>
        <span>Ошибки <b>{{progress?.failed??0}}</b></span>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button :disabled="status.busy||!available" @click="start"><Download class="size-4"/>Выгрузить</Button>
        <Button variant="outline" :disabled="!status.busy" @click="api?.stop()"><Pause class="size-4"/>Пауза</Button>
        <Button variant="outline" :disabled="status.busy||!paused" @click="resume"><Play class="size-4"/>Продолжить</Button>
      </div>
      <p v-if="error" role="alert" class="text-sm text-destructive">{{error}}</p>
    </section>
  </template>
  <section v-else class="booster-setting-card"><span>Модуль VK Booster ещё не инициализирован.</span></section>
</template>
