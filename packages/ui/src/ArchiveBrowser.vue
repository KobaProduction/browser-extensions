<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  Boxes,
  ChevronDown,
  ChevronRight,
  Database,
  RefreshCw,
  X,
} from 'lucide-vue-next'
import { translate, type SupportedLocale } from './i18n'
import type {
  ArchiveConversationView,
  ArchiveDataAdapter,
  ArchiveMessageView,
  ArchiveProjectView,
} from './mount'

const props = defineProps<{
  archiveAdapter: ArchiveDataAdapter
  initialConversationId?: string | null
  locale: SupportedLocale
}>()

const emit = defineEmits<{ close: [] }>()
const t = (key: Parameters<typeof translate>[1]) => translate(props.locale, key)

const conversations = ref<ArchiveConversationView[]>([])
const projects = ref<ArchiveProjectView[]>([])
const selectedConversationId = ref<string | null>(props.initialConversationId ?? null)
const messages = ref<ArchiveMessageView[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const expanded = ref(new Set<string>())

const grouped = computed(() => {
  const groups = new Map<string, ArchiveConversationView[]>()
  for (const conversation of conversations.value) {
    const key = conversation.projectId ?? '__none__'
    const list = groups.get(key) ?? []
    list.push(conversation)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([projectId, items]) => ({ projectId, items }))
})

const selectedConversation = computed(() =>
  conversations.value.find((item) => item.conversationId === selectedConversationId.value),
)

function projectLabel(projectId: string) {
  if (projectId === '__none__') return t('archive.noProject')
  const project = projects.value.find((item) => item.projectId === projectId)
  return project?.title || t("archive.project") + " · " + projectId.slice(0, 14) + "…"
}

function formatDate(value: number | null) {
  if (!value) return '—'
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value
  return new Date(milliseconds).toLocaleString()
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function messageText(message: ArchiveMessageView): string {
  const content = plainRecord(message.raw.content)
  if (!content) return ''
  const parts = content.parts
  if (Array.isArray(parts)) {
    return parts
      .map((part) => {
        if (typeof part === 'string') return part
        const record = plainRecord(part)
        if (!record) return JSON.stringify(part)
        if (typeof record.text === 'string') return record.text
        if (typeof record.content === 'string') return record.content
        const kind = typeof record.content_type === 'string' ? record.content_type : 'content'
        const pointer =
          typeof record.asset_pointer === 'string'
            ? record.asset_pointer
            : typeof record.file_id === 'string'
              ? record.file_id
              : ''
        const name = typeof record.name === 'string' ? record.name : ''
        return '[' + kind + '] ' + (name || pointer)
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof content.text === 'string') return content.text
  return ''
}

function toggleRaw(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

async function loadConversations() {
  loading.value = true
  error.value = null
  try {
    const [nextConversations, nextProjects] = await Promise.all([
      props.archiveAdapter.listConversations(),
      props.archiveAdapter.listProjects(),
    ])
    conversations.value = nextConversations
    projects.value = nextProjects
    if (!selectedConversationId.value && conversations.value.length) {
      selectedConversationId.value = conversations.value[0]?.conversationId ?? null
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

async function loadMessages(conversationId: string | null) {
  messages.value = []
  expanded.value = new Set()
  if (!conversationId) return
  loading.value = true
  error.value = null
  try {
    messages.value = await props.archiveAdapter.listMessages(conversationId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

watch(selectedConversationId, (value) => void loadMessages(value))
onMounted(async () => {
  await loadConversations()
  await loadMessages(selectedConversationId.value)
})
</script>

<template>
  <div class="booster-archive-browser">
    <header class="booster-archive-header">
      <div class="booster-archive-title">
        <Database class="size-5" />
        <div>
          <strong>{{ t('archive.title') }}</strong>
          <span>{{ t('archive.subtitle') }}</span>
        </div>
      </div>
      <div class="booster-archive-header-actions">
        <button
          type="button"
          class="booster-icon-button"
          :title="t('archive.refresh')"
          @click="loadConversations"
        >
          <RefreshCw class="size-4" />
        </button>
        <button
          type="button"
          class="booster-icon-button"
          :title="t('archive.close')"
          @click="emit('close')"
        >
          <X class="size-4" />
        </button>
      </div>
    </header>

    <div class="booster-archive-layout">
      <aside class="booster-archive-sidebar">
        <div v-if="!conversations.length && !loading" class="booster-archive-empty">
          {{ t('archive.empty') }}
        </div>
        <section v-for="group in grouped" :key="group.projectId" class="booster-archive-group">
          <div class="booster-archive-project">
            <Boxes class="size-4" />
            <span>{{ projectLabel(group.projectId) }}</span>
            <small>{{ group.items.length }}</small>
          </div>
          <button
            v-for="conversation in group.items"
            :key="conversation.conversationId"
            type="button"
            class="booster-archive-conversation"
            :class="{ active: selectedConversationId === conversation.conversationId }"
            @click="selectedConversationId = conversation.conversationId"
          >
            <strong>{{ conversation.title || t('archive.untitled') }}</strong>
            <span>{{ conversation.archiveState }} · {{ formatDate(conversation.updatedAt) }}</span>
          </button>
        </section>
      </aside>

      <main class="booster-archive-content">
        <div v-if="error" class="booster-archive-error">{{ error }}</div>
        <template v-else-if="selectedConversation">
          <div class="booster-archive-conversation-head">
            <div>
              <button
                type="button"
                class="booster-archive-back"
                :title="t('archive.back')"
                @click="selectedConversationId = null"
              >
                <ArrowLeft class="size-4" />
              </button>
              <strong>{{ selectedConversation.title || t('archive.untitled') }}</strong>
              <span>{{ selectedConversation.conversationId }}</span>
            </div>
            <div class="booster-archive-meta">
              <span>{{ selectedConversation.archiveState }}</span>
              <span v-if="selectedConversation.projectId">{{ selectedConversation.projectId }}</span>
              <span v-if="selectedConversation.branchSourceConversationId">
                branch ← {{ selectedConversation.branchSourceConversationId }}
              </span>
            </div>
          </div>

          <div class="booster-archive-messages">
            <article
              v-for="message in messages"
              :key="message.messageKey"
              class="booster-archive-message"
              :class="`role-${message.role || 'unknown'}`"
            >
              <div class="booster-archive-message-head">
                <strong>{{ message.role || 'unknown' }}</strong>
                <span>{{ message.contentType || message.messageType || 'message' }}</span>
                <span>{{ formatDate(message.createTime) }}</span>
                <span v-if="message.channel">{{ message.channel }}</span>
                <span v-if="message.recipient">→ {{ message.recipient }}</span>
                <span v-if="message.modelSlug">{{ message.modelSlug }}</span>
                <span v-if="message.status">{{ message.status }}</span>
              </div>
              <div v-if="messageText(message)" class="booster-archive-message-text">
                {{ messageText(message) }}
              </div>
              <button type="button" class="booster-raw-toggle" @click="toggleRaw(message.messageKey)">
                <ChevronDown v-if="expanded.has(message.messageKey)" class="size-4" />
                <ChevronRight v-else class="size-4" />
                {{
                  expanded.has(message.messageKey)
                    ? t('archive.hideRaw')
                    : t('archive.showRaw')
                }}
              </button>
              <pre
                v-if="expanded.has(message.messageKey)"
                class="booster-archive-raw"
              >{{ JSON.stringify(message.raw, null, 2) }}</pre>
            </article>
          </div>
        </template>
        <div v-else class="booster-archive-empty">{{ t('archive.selectConversation') }}</div>
      </main>
    </div>
  </div>
</template>
