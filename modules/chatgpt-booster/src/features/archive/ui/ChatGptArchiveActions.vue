<script setup lang="ts">
import { Archive, ArrowUpToLine, Download, Ellipsis, Settings2, ShieldCheck } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

type View = 'archive' | 'export' | 'capture' | 'settings'
const props = defineProps<{
  locale: 'ru' | 'en'
  tab: View
  hasConversation: boolean
  collecting: boolean
  collectionInsideExportOnly: boolean
}>()
const emit = defineEmits<{
  archive: []
  export: []
  collect: []
  capture: []
  settings: []
}>()
const menuOpen = ref(false)
const menuArea = ref<HTMLElement | null>(null)
const tr = (ru: string, en: string) => props.locale === 'ru' ? ru : en

function outsidePress(event: PointerEvent) {
  if (menuOpen.value && menuArea.value && !event.composedPath().includes(menuArea.value)) {
    menuOpen.value = false
  }
}
function action(kind: 'archive' | 'capture') {
  menuOpen.value = false
  if (kind === 'archive') emit('archive')
  else emit('capture')
}
// External navigation (including a capture request) must close the previous menu.
watch(() => props.tab, () => { menuOpen.value = false })
onMounted(() => window.addEventListener('pointerdown', outsidePress, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', outsidePress, true))
</script>

<template>
  <nav class="booster-export-recovery-actions" :aria-label="tr('Действия ChatGPT Booster', 'ChatGPT Booster actions')">
    <button class="booster-action-secondary" type="button" :aria-pressed="tab === 'archive'" @click="action('archive')">
      <Archive class="size-4" />{{ tr('Архив', 'Archive') }}
    </button>
    <button class="booster-action-secondary" type="button" :aria-pressed="tab === 'export'"
      :disabled="!hasConversation" @click="emit('export')">
      <Download class="size-4" />{{ tr('Экспорт', 'Export') }}
    </button>
    <button v-if="!collectionInsideExportOnly" class="booster-action-secondary"
      type="button" :disabled="!hasConversation || collecting" @click="emit('collect')">
      <ArrowUpToLine class="size-4" />{{ tr('Собрать историю', 'Collect history') }}
    </button>
    <button class="booster-action-secondary" type="button" :aria-pressed="tab === 'capture'" @click="action('capture')">
      <ShieldCheck class="size-4" />{{ tr('Сохранение', 'Capture') }}
    </button>
    <button class="booster-action-secondary" type="button" :aria-pressed="tab === 'settings'" @click="emit('settings')">
      <Settings2 class="size-4" />{{ tr('Настройки', 'Settings') }}
    </button>
    <div ref="menuArea" class="booster-reader-tools" @keydown.esc.stop="menuOpen = false">
      <button class="booster-action-secondary" type="button"
        :aria-label="tr('Дополнительные действия с архивом', 'More archive actions')"
        :aria-expanded="menuOpen" aria-haspopup="menu" @click="menuOpen = !menuOpen">
        <Ellipsis class="size-4" />{{ tr('Ещё', 'More') }}
      </button>
      <div v-if="menuOpen" class="booster-reader-tools-menu" role="menu">
        <button type="button" role="menuitem" @click="action('capture')">
          <ShieldCheck class="size-4" />{{ tr('Правила сохранения', 'Capture rules') }}
        </button>
        <button type="button" role="menuitem" @click="action('archive')">
          <Archive class="size-4" />{{ tr('Открыть сохранённые диалоги', 'Open saved conversations') }}
        </button>
      </div>
    </div>
  </nav>
</template>
