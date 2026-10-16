<script setup lang="ts">
import {
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  ScrollArea,
} from '@kobaproduction/browser-ui'
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-vue-next'
import type { ArchiveConversationGroup, ArchiveConversationListCopy } from './archive-list'

const props = defineProps<{
  groups: readonly ArchiveConversationGroup[]
  search: string
  selectedId: string | null
  expandedIds: ReadonlySet<string>
  conversationCount: number
  loading: boolean
  copy: ArchiveConversationListCopy
}>()
const emit = defineEmits<{
  'update:search': [value: string]
  toggle: [groupId: string]
  select: [conversationId: string]
}>()
function searchInput(value: string | number) {
  emit('update:search', String(value))
}
function expanded(groupId: string) {
  return props.expandedIds.has(groupId) || !!props.search.trim()
}
function toggleGroup(groupId: string, open: boolean) {
  // Search reveals all matches without rewriting the user's saved group state.
  if (!props.search.trim() && open !== props.expandedIds.has(groupId)) emit('toggle', groupId)
}
</script>
<template>
  <aside class="booster-reader-sidebar booster-archive-nav" :aria-label="copy.search">
    <Input :model-value="search" type="search" :aria-label="copy.search" :placeholder="copy.search" @update:model-value="searchInput" />
    <ScrollArea class="min-h-0 min-w-0 flex-1">
      <div class="grid min-w-0 gap-3 pt-3 pe-3">
        <p v-if="loading && !conversationCount" role="status" class="text-sm text-muted-foreground">{{ copy.loading }}</p>
        <p v-else-if="!conversationCount" class="text-sm text-muted-foreground">{{ copy.empty }}</p>
        <p v-else-if="!groups.length" class="text-sm text-muted-foreground">{{ copy.noResults }}</p>
        <Collapsible v-for="group in groups" :key="group.id" as="section" :open="expanded(group.id)" @update:open="toggleGroup(group.id, $event)">
          <div class="flex min-w-0 items-center gap-1">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" type="button" class="min-w-0 flex-1 justify-start gap-1.5 px-1.5">
                <ChevronDown v-if="expanded(group.id)" class="size-4 shrink-0" aria-hidden="true" />
                <ChevronRight v-else class="size-4 shrink-0" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate text-start">{{ group.label }}</span>
                <Badge variant="secondary" class="shrink-0 px-1.5 py-0 text-[10px] tabular-nums">{{ group.count }}</Badge>
              </Button>
            </CollapsibleTrigger>
            <slot name="group-action" :group="group" />
          </div>
          <CollapsibleContent>
            <div class="grid min-w-0 gap-1 pt-1">
              <Button
                v-for="entry in group.rows"
                :key="entry.id"
                type="button"
                size="sm"
                :variant="selectedId === entry.id ? 'secondary' : 'ghost'"
                class="h-auto min-h-9 w-full min-w-0 justify-start overflow-hidden py-2 text-start"
                :class="{ 'booster-archive-nav-branch': entry.branched }"
                :style="{ paddingInlineStart: `min(${10 + Math.max(0, Math.min(entry.depth, 12)) * 14}px, 35%)` }"
                :aria-current="selectedId === entry.id ? 'true' : undefined"
                :title="entry.sourceMissing ? copy.missingBranch : entry.title || copy.untitled"
                @click="emit('select', entry.id)"
              >
                <GitBranch v-if="entry.branched" class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 truncate">{{ entry.title || copy.untitled }}</span>
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </ScrollArea>
  </aside>
</template>
