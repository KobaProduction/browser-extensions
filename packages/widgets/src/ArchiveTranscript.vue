<script setup lang="ts">
import ArchiveRecordList from './ArchiveRecordList.vue'
import type {
  ArchiveTranscriptCopy,
  ArchiveTranscriptRecord,
  ArchiveTranscriptTurn,
} from './archive-transcript'

defineProps<{
  turns: readonly ArchiveTranscriptTurn[]
  isEmpty: boolean
  targetMessageId: string | null
  copy: ArchiveTranscriptCopy
}>()
const recordKey = (record: ArchiveTranscriptRecord) => record.key
const messageId = (record: ArchiveTranscriptRecord) => record.messageId
</script>
<template>
  <div class="booster-reader-exchanges">
    <p v-if="isEmpty" class="booster-note">{{copy.empty}}</p>
    <article v-for="turn in turns" :key="turn.id" class="booster-exchange">
      <p v-if="turn.association==='unassigned'" class="booster-note">{{copy.unassigned}}</p>
      <p v-else-if="turn.association==='adjacency'" class="booster-note">{{copy.adjacency}}</p>
      <ArchiveRecordList :records="turn.users" :record-key="recordKey" :message-id="messageId" :target-message-id="targetMessageId"><template #record="{ record }"><slot name="record" :record="record" /></template></ArchiveRecordList>
      <div v-if="turn.details.length" class="booster-exchange-details">
        <div class="booster-exchange-details-label">{{copy.details}} · {{turn.details.length}}</div>
        <ArchiveRecordList :records="turn.details" :record-key="recordKey" :message-id="messageId" :target-message-id="targetMessageId"><template #record="{ record }"><slot name="record" :record="record" /></template></ArchiveRecordList>
      </div>
      <ArchiveRecordList :records="turn.replies" :record-key="recordKey" :message-id="messageId" :target-message-id="targetMessageId"><template #record="{ record }"><slot name="record" :record="record" /></template></ArchiveRecordList>
    </article>
  </div>
</template>
