<script setup lang="ts">
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
function searchInput(event: Event) {
  const target = event.target
  if (target instanceof HTMLInputElement) emit('update:search', target.value)
}
</script>
<template>
  <aside class="booster-reader-sidebar">
    <input :value="search" type="search" :aria-label="copy.search" :placeholder="copy.search" @input="searchInput" />
    <p v-if="loading && !conversationCount" role="status" class="booster-note">{{ copy.loading }}</p>
    <p v-else-if="!conversationCount" class="booster-note">{{ copy.empty }}</p>
    <p v-else-if="!groups.length" class="booster-note">{{ copy.noResults }}</p>
    <section v-for="group in groups" :key="group.id" class="booster-reader-group">
      <div class="booster-reader-group-header">
        <button class="booster-group-toggle" type="button" :aria-expanded="expandedIds.has(group.id) || !!search.trim()" @click="emit('toggle', group.id)">
          <ChevronDown v-if="expandedIds.has(group.id) || search.trim()" class="size-4"/>
          <ChevronRight v-else class="size-4"/>
          <span>{{ group.label }}</span><small>{{ group.count }}</small>
        </button>
        <slot name="group-action" :group="group"/>
      </div>
      <div v-if="expandedIds.has(group.id) || search.trim()" class="booster-reader-chat-list">
        <button
          v-for="entry in group.rows"
          :key="entry.id"
          type="button"
          :class="{ active: selectedId === entry.id, 'is-branch': entry.branched }"
          :style="{ paddingInlineStart: (10 + Math.min(entry.depth, 12) * 14) + 'px' }"
          :title="entry.sourceMissing ? copy.missingBranch : entry.title || copy.untitled"
          @click="emit('select', entry.id)"
        >
          <GitBranch v-if="entry.branched" class="booster-reader-branch-icon size-3.5"/>
          <span>{{ entry.title || copy.untitled }}</span>
        </button>
      </div>
    </section>
  </aside>
</template>
