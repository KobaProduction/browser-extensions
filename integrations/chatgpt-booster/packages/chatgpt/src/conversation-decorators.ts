import type { ArchiveRecordView } from '@chatgpt-booster/core'
import {
  CHATGPT_DOM_MUTATION_ATTRIBUTES,
  type ChatGptMessageTarget,
  findChatGptTurnRoot,
  findChatGptTurnRoots,
  resolveChatGptDomAdapter,
} from './chatgpt-dom-adapter'
import {
  currentConversationId,
  currentConversationTitle,
  currentProjectId,
} from './conversation-scroll'
import { type ScheduledIdleTask, scheduleIdleTask } from './idle-task'

export type ConversationMessageTarget = ChatGptMessageTarget

export interface ConversationDecorationObserver {
  scan(): void
  stop(): void
}

const targetCache = new WeakMap<HTMLElement, ConversationMessageTarget>()

export function findConversationMessageTargets(
  root: ParentNode = document,
): ConversationMessageTarget[] {
  const adapter = resolveChatGptDomAdapter(root)
  if (!adapter) return []

  const result: ConversationMessageTarget[] = []
  for (const discovered of adapter.findMessageTargets(root)) {
    const cached = targetCache.get(discovered.message)
    if (
      cached?.message.isConnected &&
      cached.actions.isConnected &&
      cached.metadataMount.isConnected &&
      cached.section === discovered.section &&
      cached.actions === discovered.actions &&
      cached.metadataMount === discovered.metadataMount &&
      cached.messageId === discovered.messageId &&
      cached.role === discovered.role &&
      cached.domContract === discovered.domContract
    ) {
      result.push(cached)
      continue
    }
    targetCache.set(discovered.message, discovered)
    result.push(discovered)
  }
  return result
}

export function observeConversationDecorations(
  onScan: (targets: ConversationMessageTarget[], root: ParentNode) => void,
): ConversationDecorationObserver {
  let stopped = false
  let scheduled: ScheduledIdleTask | undefined
  const pending = new Set<ParentNode>()

  const scan = (root: ParentNode = document) => {
    if (stopped) return
    onScan(findConversationMessageTargets(root), root)
  }

  const flush = () => {
    scheduled = undefined
    if (stopped) return
    const roots = pending.size ? [...pending] : [document]
    pending.clear()
    for (const root of roots) scan(root)
  }

  const queue = (root: ParentNode) => {
    pending.add(root)
    if (scheduled) return
    scheduled = scheduleIdleTask(flush, 320, 120)
  }

  const observer = new MutationObserver((records) => {
    const main = document.querySelector<HTMLElement>('main')
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      if (main && target && target !== main && !main.contains(target) && !target.contains(main))
        continue

      if (target) {
        const turn = findChatGptTurnRoot(target)
        if (turn) queue(turn)
      }

      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue
        if (main && node !== main && !main.contains(node) && !node.contains(main)) continue
        const owner = findChatGptTurnRoot(node)
        if (owner) queue(owner)
        for (const turn of findChatGptTurnRoots(node)) queue(turn)
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [...CHATGPT_DOM_MUTATION_ATTRIBUTES],
  })
  queue(document)

  return {
    scan() {
      queue(document)
    },
    stop() {
      stopped = true
      observer.disconnect()
      scheduled?.cancel()
      scheduled = undefined
      pending.clear()
    },
  }
}

export interface ConversationDomSnapshot {
  conversationId: string
  projectId: string | null
  title: string | null
  observedAt: number
  records: ArchiveRecordView[]
}

/**
 * Lossy, transient fallback used only when Booster attached after ChatGPT already
 * fetched the initial conversation page. It never claims archive completeness.
 */
export function conversationDomSnapshotFromTargets(
  targets: readonly ConversationMessageTarget[],
): ConversationDomSnapshot | undefined {
  const conversationId = currentConversationId()
  if (!conversationId || !targets.length) return undefined
  const observedAt = Date.now()
  const records: ArchiveRecordView[] = targets.map((target) => {
    const text = (target.message.textContent || '').trim()
    const role = target.role
    return {
      messageKey: conversationId + ':' + target.messageId,
      messageId: target.messageId,
      conversationId,
      role,
      channel: role === 'assistant' ? 'final' : null,
      contentType: 'text',
      messageType: null,
      recipient: role === 'assistant' ? 'all' : null,
      status: null,
      modelSlug: null,
      parentId: null,
      turnExchangeId: null,
      workingTurnId: null,
      authorName: null,
      createTime: null,
      updateTime: null,
      resolvedModelSlug: null,
      firstSeenAt: observedAt,
      raw: {
        id: target.messageId,
        author: { role },
        content: { content_type: 'text', parts: [text] },
        metadata: { booster_dom_snapshot: true },
        recipient: role === 'assistant' ? 'all' : null,
      },
    }
  })
  return {
    conversationId,
    projectId: currentProjectId() ?? null,
    title: currentConversationTitle() ?? null,
    observedAt,
    records,
  }
}
export function currentConversationDomSnapshot(
  root: ParentNode = document,
): ConversationDomSnapshot | undefined {
  return conversationDomSnapshotFromTargets(findConversationMessageTargets(root))
}
