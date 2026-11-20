<script setup lang="ts">
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  TooltipHint,
} from '@kobaproduction/browser-ui'
import {
  ArrowLeft,
  ChevronRight,
  Database,
  Ellipsis,
  GitBranch,
  GripHorizontal,
  Info,
} from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import type { SupportedLocale } from './i18n'

const props = defineProps<{
  locale: SupportedLocale
  hasBranches: boolean
  selectionEnabled: boolean
  canStartRange: boolean
  hasRangeStart: boolean
  canEndRange: boolean
  rangeLoading: boolean
  hasIntegrity: boolean
  versionCount: number | null
}>()
const open = defineModel<boolean>('open', { required: true })
const serviceRecords = defineModel<boolean>('serviceRecords', { required: true })
const emit = defineEmits<{
  branches: []
  toggleSelection: []
  startRange: []
  endRange: []
  details: [kind: 'integrity' | 'versions']
}>()
const trigger = ref<{ $el: HTMLElement } | null>(null)
const page = ref<'main' | 'diagnostics'>('main')
const text = (ru: string, en: string) => (props.locale === 'ru' ? ru : en)
watch(open, (visible) => {
  if (visible) page.value = 'main'
})
function showPage(next: typeof page.value, event: Event) {
  const panel = (event.currentTarget as HTMLElement).closest('.booster-reader-action-menu')
  page.value = next
  void nextTick(() => panel?.querySelector<HTMLButtonElement>('button')?.focus())
}
function focus() {
  const element = trigger.value?.$el
  if (element instanceof HTMLElement) element.focus({ preventScroll: true })
}
defineExpose({ focus })
</script>

<template>
  <Popover v-model:open="open">
    <!-- Anchor the menu outside the tooltip's own positioning context. -->
    <PopoverAnchor as-child>
      <span class="booster-reader-tools-anchor inline-flex">
        <TooltipHint :label="text('Действия с архивом', 'Archive actions')">
          <PopoverTrigger as-child>
            <Button ref="trigger" variant="ghost" size="icon-sm" type="button"
              class="booster-reader-tools-toggle" :aria-label="text('Действия с архивом', 'Archive actions')">
              <Ellipsis class="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipHint>
      </span>
    </PopoverAnchor>
    <PopoverContent align="end" class="booster-reader-action-menu p-1" :aria-label="text('Действия с архивом', 'Archive actions')">
      <template v-if="page === 'main'">
        <Button v-if="hasBranches" variant="ghost" size="sm" @click="open = false; emit('branches')">
          <GitBranch class="size-4" />{{ text('Ветки диалога', 'Conversation branches') }}
        </Button>
        <Button variant="ghost" size="sm" :aria-pressed="selectionEnabled" @click="open = false; emit('toggleSelection')">
          <GripHorizontal class="size-4" />{{ selectionEnabled ? text('Завершить выбор', 'Finish selecting') : text('Выбрать сообщения', 'Select messages') }}
        </Button>
        <template v-if="selectionEnabled">
          <Button v-if="canStartRange" variant="ghost" size="sm" :disabled="rangeLoading" @click="open = false; emit('startRange')">{{ text('Начать диапазон здесь', 'Start range here') }}</Button>
          <Button v-if="hasRangeStart" variant="ghost" size="sm" :disabled="rangeLoading || !canEndRange" @click="open = false; emit('endRange')">{{ text('Закончить диапазон здесь', 'End range here') }}</Button>
        </template>
        <div v-if="$slots.default" class="booster-reader-menu-group"><slot /></div>
        <div class="booster-reader-menu-group">
          <Button :variant="serviceRecords ? 'secondary' : 'ghost'" size="sm" :aria-pressed="serviceRecords" @click="serviceRecords = !serviceRecords">
            <Database class="size-4" />{{ text('Служебные записи', 'Service records') }}
          </Button>
          <Button v-if="hasIntegrity || versionCount !== null" variant="ghost" size="sm" @click="showPage('diagnostics', $event)">
            <Info class="size-4" />{{ text('Диагностика', 'Diagnostics') }}<ChevronRight class="ms-auto size-4" aria-hidden="true" />
          </Button>
        </div>
      </template>
      <template v-else>
        <Button variant="ghost" size="sm" @click="showPage('main', $event)"><ArrowLeft class="size-4" />{{ text('Назад', 'Back') }}</Button>
        <p class="px-2 py-1 text-xs text-muted-foreground">{{ text('Диагностика', 'Diagnostics') }}</p>
        <Button v-if="hasIntegrity" variant="ghost" size="sm" @click="open = false; emit('details', 'integrity')">
          <Info class="size-4" />{{ text('Проверить целостность', 'Check integrity') }}
        </Button>
        <Button v-if="versionCount !== null" variant="ghost" size="sm" @click="open = false; emit('details', 'versions')">
          <GitBranch class="size-4" />{{ text('Версии сообщения', 'Message versions') }} · {{ versionCount }}
        </Button>
      </template>
    </PopoverContent>
  </Popover>
</template>
