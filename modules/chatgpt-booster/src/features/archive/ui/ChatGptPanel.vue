<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { Archive, Download, Settings2 } from 'lucide-vue-next'
import { SHELL_CLOSE_EVENT } from '@kobaproduction/browser-core'
import { OPEN_ARCHIVE_EVENT, OPEN_CAPTURE_SETTINGS_EVENT, OPEN_SETTINGS_EVENT } from '@chatgpt-booster/core'
import ArchiveBrowser from '../../../../packages/ui/src/ArchiveBrowser.vue'
import ArchiveExportDialog from '../../../../packages/ui/src/ArchiveExportDialog.vue'
import ControlCenter from '../../../../packages/ui/src/ControlCenterPanel.vue'
import { installBoosterShadowStyles } from '../../../../packages/ui/src/shadow-styles'
import { resolveLocale } from '../../../../packages/ui/src/i18n'
import { chatGptViewContext, chatGptRequestedSection } from '../../../index'
const tab = ref<'archive' | 'export' | 'settings'>('archive')
watch(chatGptRequestedSection, (section) => {
  if (section === 'archive') tab.value = 'archive'
  if (section === 'settings' || section === 'capture') tab.value = 'settings'
}, { immediate: true })
const selectedChat = ref<{ id: string; title: string | null } | null>(null)
const context = computed(() => chatGptViewContext.value)
const locale = ref<'ru' | 'en'>('ru')
let alive = true
async function currentExport() {
  if (!context.value) return
  const selected = await context.value.archiveAdapter.getCurrentContext()
  if (!alive || !selected.conversationId) return
  selectedChat.value = { id: selected.conversationId, title: selected.conversationTitle }
  tab.value = 'export'
}
function selectExport(id: string, title: string | null) {
  selectedChat.value = { id, title }
  tab.value = 'export'
}
function showArchive() { tab.value = 'archive' }
function closePanel() { window.dispatchEvent(new Event(SHELL_CLOSE_EVENT)) }
function showSettings() { tab.value = 'settings' }
onMounted(() => {
  const root = document.getElementById('koba-browser-tools-root')?.shadowRoot
  if (root) installBoosterShadowStyles(root)
  window.addEventListener(OPEN_ARCHIVE_EVENT, showArchive)
  window.addEventListener(OPEN_SETTINGS_EVENT, showSettings)
  window.addEventListener(OPEN_CAPTURE_SETTINGS_EVENT, showSettings)
  void context.value?.settingsAdapter.get().then(s => {
    if (alive) locale.value = resolveLocale(s.language) === 'en' ? 'en' : 'ru'
  })
})
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener(OPEN_ARCHIVE_EVENT, showArchive)
  window.removeEventListener(OPEN_SETTINGS_EVENT, showSettings)
  window.removeEventListener(OPEN_CAPTURE_SETTINGS_EVENT, showSettings)
})
</script>
<template>
  <div class="booster-chatgpt-panel" :lang="locale">
    <nav class="booster-export-recovery-actions" aria-label="ChatGPT Booster">
      <button class="booster-action-secondary" type="button" :aria-pressed="tab==='archive'" @click="tab='archive'"><Archive class="size-4" />{{ locale==='ru'?'Архив':'Archive' }}</button>
      <button class="booster-action-secondary" type="button" :aria-pressed="tab==='export'" @click="currentExport"><Download class="size-4" />{{ locale==='ru'?'Экспорт':'Export' }}</button>
      <button class="booster-action-secondary" type="button" :aria-pressed="tab==='settings'" @click="tab='settings'"><Settings2 class="size-4" />{{ locale==='ru'?'Настройки':'Settings' }}</button>
    </nav>
    <div v-if="!context" role="status">{{ locale==='ru'?'Архив запускается…':'Loading archive…' }}</div>
    <ArchiveBrowser v-else-if="tab==='archive'" :archive-adapter="context.archiveAdapter" :locale="locale" :windowed="false" @export="selectExport" @close="closePanel" />
    <ArchiveExportDialog v-else-if="tab==='export' && selectedChat" :key="selectedChat.id" :archive-adapter="context.archiveAdapter"
      :settings-adapter="context.settingsAdapter" :conversation-id="selectedChat.id" :title="selectedChat.title" :locale="locale"
      @close="tab='archive'" @open-archive="showArchive" @open-capture="showSettings" />
    <div v-else-if="tab==='export'" role="status">{{ locale==='ru'?'Открой диалог ChatGPT для экспорта':'Open a ChatGPT conversation to export' }}</div>
    <ControlCenter v-else :settings-adapter="context.settingsAdapter" :archive-adapter="context.archiveAdapter"
      :diagnostics-adapter="context.diagnosticsAdapter" :persistent-diagnostics-adapter="context.persistentDiagnosticsAdapter"
      :secret-adapter="context.secretAdapter" :telemetry-control-adapter="context.telemetryControlAdapter"
      :target-label="context.targetLabel" :show-close="false" :embedded="true" />
  </div>
</template>
