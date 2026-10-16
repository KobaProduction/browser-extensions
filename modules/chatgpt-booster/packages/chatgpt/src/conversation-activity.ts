import type { AgentActivitySnapshot } from '@chatgpt-booster/core'
import { CHATGPT_DOM_MUTATION_ATTRIBUTES, resolveChatGptDomAdapter } from './chatgpt-dom-adapter'
import { currentConversationId } from './conversation-scroll'

export interface ConversationActivityObservation {
  /** Placement metadata only. Business activity is supplied by the network state store. */
  snapshot: AgentActivitySnapshot
  section: HTMLElement | null
  mount: HTMLElement | null
}
export interface ConversationActivityObserver {
  scan(): void
  stop(): void
}

/** A renderer can identify a mount and message identity, never a request state or time. */
export function readConversationActivity() {
  const adapter = resolveChatGptDomAdapter(document)
  const section = adapter?.latestAssistantTurn(document) ?? null
  return {
    active: false,
    phase: 'idle' as const,
    turnId: section && adapter ? adapter.turnId(section) : null,
    turnState: null,
    label: null,
    tool: null,
    fingerprint: section && adapter ? (adapter.turnId(section) ?? '') : '',
    section,
    mount: section && adapter ? adapter.activityMount(section) : null,
  }
}

export function observeConversationActivity(
  listener: (observation: ConversationActivityObservation) => void,
): ConversationActivityObserver {
  let stopped = false
  let frame = 0
  let force = true
  let previousSection: HTMLElement | null | undefined
  let previousMount: HTMLElement | null | undefined
  let previousTurn: string | null | undefined
  const scan = () => {
    frame = 0
    if (stopped) return
    const placement = readConversationActivity()
    if (
      !force &&
      placement.section === previousSection &&
      placement.mount === previousMount &&
      placement.turnId === previousTurn
    )
      return
    force = false
    previousSection = placement.section
    previousMount = placement.mount
    previousTurn = placement.turnId
    listener({
      section: placement.section,
      mount: placement.mount,
      snapshot: {
        conversationId: currentConversationId() ?? null,
        turnId: placement.turnId,
        active: false,
        phase: 'idle',
        startedAt: null,
        reasoningStartedAt: null,
        phaseStartedAt: null,
        completedAt: null,
        lastActivityAt: null,
        durationMs: null,
        reasoningDurationMs: null,
        label: null,
        tool: null,
      },
    })
  }
  const queue = () => {
    if (stopped || frame) return
    frame = requestAnimationFrame(scan)
  }
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => {
        const element = record.target instanceof Element ? record.target : record.target.parentElement
        return (
          element?.closest('main') ||
          [...record.addedNodes].some((node) => node instanceof Element && node.closest('main'))
        )
      })
    )
      queue()
  })
  observer.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: CHATGPT_DOM_MUTATION_ATTRIBUTES,
  })
  queue()
  return {
    scan() {
      force = true
      queue()
    },
    stop() {
      stopped = true
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
