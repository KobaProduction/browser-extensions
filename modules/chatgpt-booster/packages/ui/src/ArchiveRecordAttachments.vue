<script setup lang="ts">
import { currentConversationId, currentResolvedAssetUrls } from '@chatgpt-booster/chatgpt'
import type { ArchiveAttachmentView } from '@chatgpt-booster/core'
import { Button, ModalSurface } from '@kobaproduction/browser-ui'
import Download from 'lucide-vue-next/dist/esm/icons/download.js'
import ExternalLink from 'lucide-vue-next/dist/esm/icons/external-link.js'
import ImageIcon from 'lucide-vue-next/dist/esm/icons/image.js'
import Paperclip from 'lucide-vue-next/dist/esm/icons/paperclip.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, ref } from 'vue'
import CopyIdentity from './CopyIdentity.vue'
import { type SupportedLocale, type TranslationKey, translate } from './i18n'

const props = defineProps<{
  files: ArchiveAttachmentView[]
  conversationId: string
  locale: SupportedLocale
}>()
const selectedId = ref<string | null>(null)
const selected = computed(() => props.files.find((file) => file.assetId === selectedId.value))
const resolvedUrl = ref<string | null>(null)
const libraryFileId = computed(() => selected.value?.libraryFileId)
const openUrl = computed(() =>
  libraryFileId.value
    ? `https://chatgpt.com/space/file/${encodeURIComponent(libraryFileId.value)}`
    : resolvedUrl.value,
)
const downloadUrl = computed(() =>
  libraryFileId.value
    ? `https://chatgpt.com/api/library/files/${encodeURIComponent(libraryFileId.value)}/content`
    : null,
)
const t = (key: TranslationKey) => translate(props.locale, key)
const name = (file: ArchiveAttachmentView) =>
  file.fileName || t(file.kind === 'image' ? 'reader.attachmentImage' : 'reader.attachmentFile')

function open(file: ArchiveAttachmentView) {
  resolvedUrl.value =
    !file.libraryFileId && currentConversationId() === props.conversationId
      ? (currentResolvedAssetUrls().find((asset) => asset.assetId === file.assetId)?.downloadUrl ?? null)
      : null
  selectedId.value = file.assetId
}
</script>

<template>
  <ul class="m-0 flex list-none flex-wrap gap-1 p-0" data-archive-attachments>
    <li v-for="file in files" :key="file.assetId" class="min-w-0 max-w-full">
      <Button variant="outline" size="sm" type="button" class="h-auto min-h-7 max-w-full gap-1.5 whitespace-normal py-1 text-left" aria-haspopup="dialog" @click="open(file)">
        <component :is="file.kind === 'image' ? ImageIcon : Paperclip" class="size-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0 [overflow-wrap:anywhere]">{{ name(file) }}</span>
      </Button>
    </li>
  </ul>
  <ModalSurface v-if="selected" :label="t('reader.attachmentDetails')" @close="selectedId = null">
    <header class="booster-record-modal-header">
      <div><strong>{{ t('reader.attachmentDetails') }}</strong><span>{{ name(selected) }}</span></div>
      <Button variant="ghost" size="icon-sm" type="button" :aria-label="t('common.close')" @click="selectedId = null"><X class="size-4" /></Button>
    </header>
    <div class="grid min-h-0 gap-3 overflow-auto p-3">
      <dl class="grid gap-2 text-xs">
        <div class="grid gap-1">
          <dt class="text-muted-foreground">{{ t('reader.attachmentId') }}</dt>
          <dd class="m-0 flex min-w-0 items-center gap-1"><code class="min-w-0 select-text [overflow-wrap:anywhere]">{{ selected.assetId }}</code><CopyIdentity label="" :identifier="selected.assetId" :locale="locale" /></dd>
        </div>
        <div v-if="selected.mimeType" class="grid gap-1">
          <dt class="text-muted-foreground">{{ t('reader.attachmentType') }}</dt><dd class="m-0 [overflow-wrap:anywhere]">{{ selected.mimeType }}</dd>
        </div>
        <div v-if="selected.sizeBytes !== null" class="grid gap-1">
          <dt class="text-muted-foreground">{{ t('reader.attachmentSize') }}</dt><dd class="m-0">{{ selected.sizeBytes.toLocaleString(locale) }} {{ t('reader.attachmentBytes') }}</dd>
        </div>
        <div v-if="selected.width !== null && selected.height !== null" class="grid gap-1">
          <dt class="text-muted-foreground">{{ t('reader.attachmentDimensions') }}</dt><dd class="m-0">{{ selected.width }} × {{ selected.height }}</dd>
        </div>
      </dl>
      <div v-if="openUrl" class="flex flex-wrap gap-2">
        <Button as-child variant="outline" size="sm">
          <a :href="openUrl" target="_blank" rel="noopener noreferrer"><ExternalLink class="size-4" aria-hidden="true" />{{ t('reader.attachmentOpen') }}</a>
        </Button>
        <Button v-if="downloadUrl" as-child variant="outline" size="sm">
          <a :href="downloadUrl" target="_blank" rel="noopener noreferrer"><Download class="size-4" aria-hidden="true" />{{ t('reader.attachmentDownload') }}</a>
        </Button>
      </div>
      <Button v-else as-child variant="outline" size="sm" class="justify-self-start">
        <a :href="`https://chatgpt.com/c/${encodeURIComponent(conversationId)}`" target="_blank" rel="noopener noreferrer"><ExternalLink class="size-4" aria-hidden="true" />{{ t('reader.attachmentOpenChat') }}</a>
      </Button>
    </div>
  </ModalSurface>
</template>
