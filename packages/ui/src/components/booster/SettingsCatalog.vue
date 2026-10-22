<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useApplicationLocale } from '../../application-locale'
import {
  findSettingsCatalogPath,
  firstSettingsCatalogLeaf,
  type SettingsCatalogEntry,
  type SettingsCatalogGroup,
} from '../../settings-catalog'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import SettingsCatalogLevels from './SettingsCatalogLevels.vue'

const props = defineProps<{
  groups: readonly SettingsCatalogGroup[]
  selected: string
  /** The displayed workspace can belong to a group without being a settings leaf. */
  activeGroup?: string
  label?: string
  /** Dense inline navigation for an embedded workspace toolbar. */
  compact?: boolean
}>()
const emit = defineEmits<{ select: [id: string] }>()
const locale = useApplicationLocale()
const text = (ru: string, en: string) => (locale.value === 'ru' ? ru : en)
const expanded = ref(false)
const groupId = ref('')
const trail = ref<string[]>([])
const selectedLocation = computed(() => {
  for (const group of props.groups) {
    const path = findSettingsCatalogPath(group.entries, props.selected)
    if (path) return { group, path }
  }
})
watch(
  [selectedLocation, () => props.groups, () => props.activeGroup],
  ([location]) => {
    if (location) {
      groupId.value = location.group.id
      trail.value = location.path.slice(0, -1).map((entry) => entry.id)
    } else {
      // Workspace ownership is explicit; no unrelated settings leaf is invented.
      groupId.value = props.groups.some((item) => item.id === props.activeGroup)
        ? (props.activeGroup ?? '')
        : ''
      trail.value = []
    }
  },
  { immediate: true, flush: 'sync' },
)
const group = computed(() => props.groups.find((item) => item.id === groupId.value))
const branch = computed(() => {
  let entries = selectedLocation.value ? (group.value?.entries ?? []) : []
  const parents: SettingsCatalogEntry[] = []
  for (const id of trail.value.slice(0, 8)) {
    const entry = entries.find((item) => item.id === id)
    if (!entry?.children?.length) break
    parents.push(entry)
    entries = entry.children
  }
  return { entries, parents }
})
const selectedTitle = computed(() =>
  selectedLocation.value
    ? [
        selectedLocation.value.group.title,
        ...selectedLocation.value.path.map((entry) => entry.title),
      ].join(' / ')
    : (group.value?.title ?? text('Выберите группу и раздел', 'Choose a group and section')),
)
function changeGroup(id: string) {
  const next = props.groups.find((item) => item.id === id)
  if (!next) return
  const first = firstSettingsCatalogLeaf(next.entries)
  // The selected route is authoritative. A slow provider transition must not
  // highlight its group while another group's parameters are still displayed.
  if (first && first.id !== props.selected) {
    emit('select', first.id)
    return
  }
  groupId.value = id
  trail.value = []
}
function enter(id: string) {
  const entry = branch.value.entries.find((item) => item.id === id)
  if (!entry) return
  if (entry.children?.length) {
    trail.value = [...branch.value.parents.map((item) => item.id), id]
    return
  }
  expanded.value = false
  emit('select', entry.id)
}
function back(depth: number) {
  trail.value = trail.value.slice(0, Math.max(0, depth))
}
</script>
<template>
  <nav class="settings-catalog min-w-0" :aria-label="label || text('Разделы и настройки','Sections and settings')">
    <Collapsible v-if="!compact" v-model:open="expanded" class="flex max-h-[calc(50dvh-1.5rem)] min-h-0 min-w-0 flex-col min-[621px]:hidden">
      <CollapsibleTrigger as-child>
          <Button data-settings-catalog-toggle type="button" variant="outline" class="h-auto min-h-11 w-full min-w-0 shrink-0 justify-between gap-3 whitespace-normal text-left">
          <span class="grid min-w-0 gap-0.5"><span>{{ expanded ? text('Свернуть разделы','Collapse sections') : text('Разделы и настройки','Sections and settings') }}</span><small class="break-words font-normal text-muted-foreground">{{ selectedTitle }}</small></span>
          <ChevronDown class="size-4 shrink-0 transition-transform" :class="{ 'rotate-180': expanded }" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent class="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-3">
        <SettingsCatalogLevels :groups="groups" :group-id="groupId" :parents="branch.parents" :entries="branch.entries" :selected="selected" @group="changeGroup" @enter="enter" @back="back" />
      </CollapsibleContent>
    </Collapsible>
    <SettingsCatalogLevels :class="compact ? 'block' : 'hidden min-[621px]:block'" :compact="compact" :groups="groups" :group-id="groupId" :parents="branch.parents" :entries="branch.entries" :selected="selected" @group="changeGroup" @enter="enter" @back="back" />
  </nav>
</template>
