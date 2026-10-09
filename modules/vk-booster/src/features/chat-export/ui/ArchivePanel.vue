<script setup lang="ts">
/** VK-only archive API adapter. Generic ArchiveManager owns presentation, never VK storage. */

import {
  ArchiveManager,
  type ArchiveManagerOptions,
  type ArchiveManagerState,
} from '@kobaproduction/browser-widgets'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { type ArchiveStatus, archiveApi } from '../model/types'

const api = archiveApi()
const status = ref<ArchiveStatus | null>(api?.status() ?? null)
const error = ref('')
let unsubscribe: (() => void) | undefined
const view = computed<ArchiveManagerState | null>(() => {
  const current = status.value
  if (!current) return null
  const p = current.progress
  return {
    context: 'Диалог ' + (current.options.peerId || 'не выбран'),
    folder: current.folder,
    messages: current.messages,
    busy: current.busy,
    paused: current.checkpoint?.status === 'paused',
    phase: p.phase,
    done: p.done,
    total: p.total,
    newCount: p.newCount ?? 0,
    downloaded: p.downloaded ?? 0,
    failed: p.failed ?? 0,
    error: p.error,
  }
})
onMounted(() => {
  unsubscribe = api?.subscribe((next) => {
    status.value = next
  })
})
onUnmounted(() => unsubscribe?.())
async function chooseFolder() {
  error.value = ''
  try {
    await api?.selectFolder()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
async function start(options: ArchiveManagerOptions) {
  error.value = ''
  try {
    await api?.run(options)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
async function resume() {
  error.value = ''
  try {
    await api?.resume()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>
<template>
  <ArchiveManager v-if="status && view" :state="view" :initial="status.options" :error="error"
    title="Архив переписки VK" @choose-folder="chooseFolder" @start="start"
    @stop="api?.stop()" @resume="resume"/>
  <section v-else class="booster-setting-card"><span>Модуль VK Booster ещё не инициализирован.</span></section>
</template>
