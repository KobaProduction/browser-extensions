<script setup lang="ts">
import {
  Button,
  ScrollArea,
  Slider,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kobaproduction/browser-ui'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ARCHIVE_TIMELINE_WINDOW_SIZE,
  type ArchiveTimelineNode,
  archiveTimelineLayout,
  archiveTimelineSameIds,
  archiveTimelineWindowStart,
} from './archive-timeline'

const props = defineProps<{
  nodes: readonly ArchiveTimelineNode[]
  activeId?: string | null
  selectedIds?: ReadonlySet<string>
  label: string
  emptyLabel: string
  uncertainLabel?: string
  disabled?: boolean
  loading?: boolean
}>()
const emit = defineEmits<{ navigate: [id: string] }>()
const root = ref<HTMLElement | null>(null)
const PAGE_SIZE = ARCHIVE_TIMELINE_WINDOW_SIZE
const ROW_HEIGHT = 24
const previewStyle = {
  boxSizing: 'border-box' as const,
  maxWidth:
    'min(20rem, var(--reka-tooltip-content-available-width, calc(100dvw - 24px)), calc(100dvw - 24px))',
  maxHeight:
    'min(20rem, var(--reka-tooltip-content-available-height, calc(100dvh - 24px)), calc(100dvh - 24px))',
  overflowY: 'auto' as const,
}
const windowStart = ref(0)
const scrubIndex = ref<number | null>(null)
const sliderHoverIndex = ref<number | null>(null)
const sliderFocused = ref(false)
const scrubbing = ref(false)
let navigationFrame: number | undefined
let queuedIndex: number | undefined
let lastRequestedId: string | undefined
let scrollRevision = 0
let commitRevision = 0
let datasetRevision = 0
let pointerDatasetRevision: number | null = null
const nodeIds = computed(() => props.nodes.map((node) => node.id))
const visibleNodes = computed(() => props.nodes.slice(windowStart.value, windowStart.value + PAGE_SIZE))
const layout = computed(() =>
  archiveTimelineLayout(visibleNodes.value, { rowHeight: ROW_HEIGHT, maxWidth: 36 }),
)
const uncertainIds = computed(
  () => new Set(visibleNodes.value.filter((node) => node.uncertain).map((node) => node.id)),
)
const selectedIndex = computed(() =>
  Math.max(
    0,
    props.nodes.findIndex((node) => node.id === props.activeId),
  ),
)
const position = computed(() => scrubIndex.value ?? selectedIndex.value)
const sliderPreviewIndex = computed(() =>
  scrubbing.value
    ? position.value
    : (sliderHoverIndex.value ?? (sliderFocused.value ? position.value : null)),
)
const sliderPreview = computed(() =>
  sliderPreviewIndex.value === null ? undefined : props.nodes[sliderPreviewIndex.value],
)
function center(index: number) {
  windowStart.value = archiveTimelineWindowStart(props.nodes.length, index, PAGE_SIZE)
}
async function revealPoint(index: number) {
  const revision = ++scrollRevision
  const id = props.nodes[index]?.id
  center(index)
  await nextTick()
  if (revision !== scrollRevision || !id) return
  const row = [...(root.value?.querySelectorAll<HTMLElement>('[data-archive-timeline-id]') ?? [])].find(
    (element) => element.dataset.archiveTimelineId === id,
  )
  row?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}
function boundedIndex(value: number) {
  return Math.max(0, Math.min(props.nodes.length - 1, Math.round(value)))
}
function cancelQueuedNavigation() {
  if (navigationFrame !== undefined) cancelAnimationFrame(navigationFrame)
  navigationFrame = undefined
  queuedIndex = undefined
}
function navigate(index: number, repeat = false) {
  const node = props.nodes[index]
  if (props.disabled || !node || (!repeat && node.id === lastRequestedId)) return
  lastRequestedId = node.id
  emit('navigate', node.id)
}
/** A drag selects the latest nearest point once per frame, never a backlog of reads. */
function scrub(value: number[] | undefined) {
  if (
    !value ||
    props.disabled ||
    !props.nodes.length ||
    (pointerDatasetRevision !== null && pointerDatasetRevision !== datasetRevision)
  )
    return
  scrubbing.value = true
  scrubIndex.value = boundedIndex(value[0] ?? 0)
  center(scrubIndex.value)
  queuedIndex = scrubIndex.value
  if (navigationFrame !== undefined) return
  navigationFrame = requestAnimationFrame(() => {
    navigationFrame = undefined
    const index = queuedIndex
    queuedIndex = undefined
    if (index !== undefined) navigate(index)
  })
}
function selectIndex(value: number[] | undefined) {
  if (
    !value ||
    props.disabled ||
    !props.nodes.length ||
    (pointerDatasetRevision !== null && pointerDatasetRevision !== datasetRevision)
  )
    return
  cancelQueuedNavigation()
  const index = boundedIndex(value[0] ?? 0)
  const revision = ++commitRevision
  scrubIndex.value = index
  scrubbing.value = false
  center(index)
  navigate(index)
  if (props.nodes[index]?.id === props.activeId) scrubIndex.value = null
  // Reka commits keyboard steps before emitting modelValue. Settle after both
  // events, so the following update cannot leave a completed gesture pending.
  void nextTick(() => {
    if (revision !== commitRevision || (scrubIndex.value !== null && scrubIndex.value !== index)) return
    cancelQueuedNavigation()
    scrubbing.value = false
    if (props.nodes[index]?.id === props.activeId) scrubIndex.value = null
  })
}
function previewSlider(event: PointerEvent) {
  if (event.pointerType === 'touch' || props.disabled || !props.nodes.length) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const bounds = target.getBoundingClientRect()
  const thumbHeight =
    target.querySelector<HTMLElement>('[role="slider"]')?.getBoundingClientRect().height ?? 0
  const travel = bounds.height - thumbHeight
  if (travel > 0)
    sliderHoverIndex.value = boundedIndex(
      ((event.clientY - bounds.top - thumbHeight / 2) / travel) * (props.nodes.length - 1),
    )
}
function cancelScrub() {
  commitRevision++
  cancelQueuedNavigation()
  scrubbing.value = false
  scrubIndex.value = null
  sliderHoverIndex.value = null
}
function beginPointer() {
  pointerDatasetRevision = datasetRevision
}
function endPointer() {
  selectIndex([position.value])
  pointerDatasetRevision = null
}
function cancelPointer() {
  pointerDatasetRevision = null
  cancelScrub()
}
function beginKeyboard() {
  pointerDatasetRevision = null
  sliderHoverIndex.value = null
  sliderFocused.value = true
}
function selectPoint(index: number) {
  commitRevision++
  cancelQueuedNavigation()
  scrubIndex.value = index
  scrubbing.value = false
  navigate(index, true)
  if (props.nodes[index]?.id === props.activeId) scrubIndex.value = null
}
watch(
  position,
  (index) => {
    void revealPoint(index)
  },
  { immediate: true },
)
watch(
  nodeIds,
  (ids, previous) => {
    if (archiveTimelineSameIds(previous, ids)) return
    // A changed logical dataset cancels old work; replacing metadata objects
    // for the same ordered IDs must not interrupt a pending navigation/drag.
    datasetRevision++
    scrollRevision++
    cancelScrub()
    lastRequestedId = undefined
    sliderFocused.value = false
    void revealPoint(selectedIndex.value)
  },
  { flush: 'sync' },
)
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) cancelScrub()
  },
)
watch(
  () => props.activeId,
  (id) => {
    if (!scrubbing.value && props.nodes[position.value]?.id === id) scrubIndex.value = null
    if (scrubIndex.value !== null) return
    lastRequestedId = undefined
  },
)
onBeforeUnmount(() => {
  pointerDatasetRevision = null
  scrollRevision++
  commitRevision++
  cancelQueuedNavigation()
})
</script>

<template>
  <TooltipProvider :delay-duration="150" :skip-delay-duration="80">
    <div v-if="nodes.length" ref="root" role="complementary" data-archive-timeline-rail class="flex h-full w-20 min-h-0 min-w-0 shrink-0 flex-col border-s border-border bg-background" :aria-label="label" :aria-busy="loading || undefined">
      <span class="shrink-0 px-1 py-1 text-center text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">{{ nodes.length ? position + 1 : 0 }} / {{ nodes.length }}</span>
      <div class="flex min-h-0 flex-1 gap-1 px-1 pb-8">
        <Tooltip v-if="nodes.length > 1" :open="!disabled && Boolean(sliderPreview)">
          <TooltipTrigger as-child>
            <div class="relative my-2 w-5 shrink-0" @pointerdown="beginPointer" @pointermove="previewSlider" @pointerleave="sliderHoverIndex = null" @pointerup="endPointer" @pointercancel="cancelPointer" @keydown="beginKeyboard" @focusin="sliderFocused = true" @focusout="sliderFocused = false">
              <Slider orientation="vertical" :inverted="true" class="mx-auto h-full shrink-0" :model-value="[position]" :min="0" :max="nodes.length - 1" :step="1" :disabled="disabled" :aria-label="label" :aria-valuetext="`${position + 1} / ${nodes.length}: ${nodes[position]?.label ?? ''} ${nodes[position]?.preview ?? ''}`" @update:model-value="scrub" @value-commit="selectIndex" />
            </div>
          </TooltipTrigger>
          <TooltipContent v-if="sliderPreview" side="left" :collision-padding="12" :avoid-collisions="true" :style="previewStyle" class="whitespace-normal [overflow-wrap:anywhere]" data-archive-timeline-preview :data-archive-timeline-preview-id="sliderPreview.id">
            <strong class="block">{{ sliderPreview.label }} · {{ (sliderPreviewIndex ?? 0) + 1 }} / {{ nodes.length }}</strong>
            <p v-if="sliderPreview.preview" class="mt-1">{{ sliderPreview.preview }}</p>
            <p v-if="sliderPreview.uncertain" class="mt-1">{{ uncertainLabel || '···' }}</p>
          </TooltipContent>
        </Tooltip>
        <ScrollArea class="h-full min-h-0 min-w-0 flex-1">
          <div class="relative min-w-0" :style="{ minHeight: `${layout.height}px` }">
            <svg class="pointer-events-none absolute start-0 top-0 z-10 text-muted-foreground" :width="layout.width" :height="layout.height" aria-hidden="true">
              <path v-for="edge in layout.edges" :key="edge.childId" :d="edge.path" fill="none" stroke="currentColor" stroke-width="1.5" :stroke-dasharray="edge.uncertain ? '3 3' : undefined" :class="{ 'text-primary': edge.childId === activeId || edge.parentId === activeId }" />
              <circle v-for="point in layout.points" :key="point.id" :cx="point.x" :cy="point.y" :r="point.id === activeId ? 5 : selectedIds?.has(point.id) ? 4 : 3" :fill="uncertainIds.has(point.id) ? 'var(--background)' : 'currentColor'" stroke="currentColor" :stroke-dasharray="uncertainIds.has(point.id) ? '2 2' : undefined" :class="point.id === activeId || selectedIds?.has(point.id) ? 'text-primary' : 'text-muted-foreground'" />
            </svg>
            <Tooltip v-for="(node, index) in visibleNodes" :key="node.id">
              <TooltipTrigger as-child>
                <Button :data-archive-timeline-id="node.id" type="button" :variant="node.id === activeId ? 'secondary' : selectedIds?.has(node.id) ? 'outline' : 'ghost'" class="flex w-full min-w-0 rounded-sm p-0" :style="{ height: `${ROW_HEIGHT}px` }" :data-selected="selectedIds?.has(node.id) || undefined" :aria-current="node.id === activeId ? 'true' : undefined" :aria-label="`${node.label}: ${node.preview || ''}${node.uncertain && uncertainLabel ? ` · ${uncertainLabel}` : ''}`" :disabled="disabled" @click="selectPoint(windowStart + index)" />
              </TooltipTrigger>
              <TooltipContent side="left" :collision-padding="12" :avoid-collisions="true" :style="previewStyle" class="whitespace-normal [overflow-wrap:anywhere]" data-archive-timeline-preview :data-archive-timeline-preview-id="node.id">
                <strong class="block">{{ node.label }} · {{ windowStart + index + 1 }} / {{ nodes.length }}</strong>
                <p v-if="node.preview" class="mt-1">{{ node.preview }}</p>
                <p v-if="node.uncertain" class="mt-1">{{ uncertainLabel || '···' }}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </ScrollArea>
      </div>
      <div v-if="nodes.length > PAGE_SIZE" class="flex shrink-0 justify-center gap-1 border-t border-border p-1">
        <Button variant="ghost" size="icon-sm" :disabled="disabled || windowStart === 0" :aria-label="`${label}: −${PAGE_SIZE}`" @click="windowStart = Math.max(0, windowStart - PAGE_SIZE)">↑</Button>
        <Button variant="ghost" size="icon-sm" :disabled="disabled || windowStart + PAGE_SIZE >= nodes.length" :aria-label="`${label}: +${PAGE_SIZE}`" @click="windowStart = Math.min(nodes.length - PAGE_SIZE, windowStart + PAGE_SIZE)">↓</Button>
      </div>
    </div>
  </TooltipProvider>
</template>
