<script setup lang="ts">
import type { ArchiveTranscriptCopy, ArchiveTranscriptTurn } from './archive-transcript'

defineProps<{
  turns: readonly ArchiveTranscriptTurn[]
  isEmpty: boolean
  targetMessageId: string | null
  copy: ArchiveTranscriptCopy
}>()
</script>
<template>
  <div class="booster-reader-exchanges">
    <p v-if="isEmpty" class="booster-note">{{copy.empty}}</p>
    <article v-for="turn in turns" :key="turn.id" class="booster-exchange">
      <p v-if="turn.association==='unassigned'" class="booster-note">{{copy.unassigned}}</p>
      <p v-else-if="turn.association==='adjacency'" class="booster-note">{{copy.adjacency}}</p>
      <div v-for="item in turn.users" :key="item.key" :data-archive-node="item.key" :data-archive-message="item.messageId"
        :class="{'booster-message-target':targetMessageId===item.messageId}" tabindex="-1">
        <slot name="record" :record="item"/>
      </div>
      <div v-if="turn.details.length" class="booster-exchange-details">
        <div class="booster-exchange-details-label">{{copy.details}} · {{turn.details.length}}</div>
        <div v-for="item in turn.details" :key="item.key" :data-archive-node="item.key" :data-archive-message="item.messageId"
          :class="{'booster-message-target':targetMessageId===item.messageId}" tabindex="-1">
          <slot name="record" :record="item"/>
        </div>
      </div>
      <div v-for="item in turn.replies" :key="item.key" :data-archive-node="item.key" :data-archive-message="item.messageId"
        :class="{'booster-message-target':targetMessageId===item.messageId}" tabindex="-1">
        <slot name="record" :record="item"/>
      </div>
    </article>
  </div>
</template>
