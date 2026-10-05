import type { ArchiveRecordView } from '@chatgpt-booster/core'
import {
  currentConversationId,
  currentConversationTitle,
  currentProjectId,
} from './conversation-scroll'
import { type ScheduledIdleTask, scheduleIdleTask } from './idle-task'

export interface ConversationMessageTarget {
  section: HTMLElement
  message: HTMLElement
  actions: HTMLElement
  messageId: string
  role: string
}

export interface ConversationDecorationObserver {
  scan(): void
  stop(): void
}

const TURN_SELECTOR = 'main section[data-testid^="conversation-turn-"]'
const MESSAGE_SELECTOR = '[data-message-id][data-message-author-role]'

const targetCache = new WeakMap<HTMLElement, ConversationMessageTarget>()

function nativeActions(section: HTMLElement): HTMLElement | null {
  const copy = section.querySelector<HTMLElement>('[data-testid="copy-turn-action-button"]')
  if (copy?.parentElement) return copy.parentElement

  const role = section.querySelector<HTMLElement>(MESSAGE_SELECTOR)?.dataset.messageAuthorRole
  const selector =
    role === 'user'
      ? 'button[aria-label*="message" i], button[aria-label*="сообщение" i]'
      : 'button[aria-label*="answer" i], button[aria-label*="ответ" i]'
  return section.querySelector<HTMLElement>(selector)?.parentElement ?? null
}

export function findConversationMessageTargets(
  root: ParentNode = document,
): ConversationMessageTarget[] {
  const result: ConversationMessageTarget[] = []
  const sections: HTMLElement[] = []
  if (root instanceof HTMLElement && root.matches(TURN_SELECTOR)) sections.push(root)
  sections.push(...root.querySelectorAll<HTMLElement>(TURN_SELECTOR))
  for (const section of sections) {
    if (section.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue
    const cached = targetCache.get(section)
    if (
      cached?.message.isConnected &&
      cached.actions.isConnected &&
      section.contains(cached.message) &&
      section.contains(cached.actions) &&
      cached.message.dataset.messageId?.trim() === cached.messageId &&
      cached.message.dataset.messageAuthorRole?.trim() === cached.role
    ) {
      result.push(cached)
      continue
    }

    const message = section.querySelector<HTMLElement>(MESSAGE_SELECTOR)
    const messageId = message?.dataset.messageId?.trim()
    const role = message?.dataset.messageAuthorRole?.trim()
    const actions = nativeActions(section)
    if (!message || !messageId || !role || !actions) continue
    const target = { section, message, actions, messageId, role }
    targetCache.set(section, target)
    result.push(target)
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
    scheduled = scheduleIdleTask(flush, 320)
  }

  const observer = new MutationObserver((records) => {
    const main = document.querySelector<HTMLElement>('main')
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      if (main && target && target !== main && !main.contains(target) && !target.contains(main))
        continue
      const section = target?.closest<HTMLElement>('section[data-testid^="conversation-turn-"]')
      if (section) queue(section)
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue
        if (main && node !== main && !main.contains(node) && !node.contains(main)) continue
        const own = node.matches('section[data-testid^="conversation-turn-"]')
          ? node
          : node.closest('section[data-testid^="conversation-turn-"]')
        if (own) queue(own)
        for (const nested of node.querySelectorAll<HTMLElement>(
          'section[data-testid^="conversation-turn-"]',
        ))
          queue(nested)
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-message-id', 'data-message-author-role', 'data-testid'],
  })
  scan()

  return {
    scan() {
      scan()
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
