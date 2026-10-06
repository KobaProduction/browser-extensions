import type { AgentActivityPhase, AgentActivitySnapshot } from '@chatgpt-booster/core'
import { currentConversationId } from './conversation-scroll'
import { findToolCallEvidence, toolInvocationFromEvidence } from './tool-calls'

export interface ConversationActivityObservation {
  snapshot: AgentActivitySnapshot
  section: HTMLElement | null
  mount: HTMLElement | null
}

export interface ConversationActivityObserver {
  scan(): void
  stop(): void
}

const TURN_SELECTOR = 'main section[data-testid^="conversation-turn-"][data-turn="assistant"]'
const RESPONSE_STATE_SELECTOR = '[data-dil-talvt-response-state]'
const STREAM_STATUS_SELECTOR = '[data-streaming-response-status]'
const ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"]'
const ACTIVE_RESPONSE_SELECTOR =
  '[data-dil-talvt-response-state="streaming"], [data-markdown-talvt-render-state="pending"], .streaming-animation'
const STOP_SELECTOR = '[data-testid="stop-button"], [data-testid="stop-generation"]'

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function latestAssistantTurn(): HTMLElement | null {
  const turns = document.querySelectorAll<HTMLElement>(TURN_SELECTOR)
  return turns.item(turns.length - 1) ?? null
}

function mountTarget(section: HTMLElement | null): HTMLElement | null {
  if (!section) return null
  return section.querySelector<HTMLElement>('[data-conversation-screenshot-content]') ?? section
}

function activityPhase(
  section: HTMLElement,
  tool: ReturnType<typeof toolInvocationFromEvidence> | null,
  statusText: string,
): AgentActivityPhase {
  if (tool) return 'tool'
  if (statusText) return 'thinking'
  if (section.querySelector(ASSISTANT_MESSAGE_SELECTOR)) return 'responding'
  return 'thinking'
}

function activityFingerprint(
  section: HTMLElement | null,
  phase: AgentActivityPhase,
  label: string | null,
  toolLabel: string | null,
) {
  if (!section) return `${phase}|${label ?? ''}|${toolLabel ?? ''}`
  const message = section.querySelector<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR)
  const text = compact(message?.textContent ?? '')
  const tail = text.slice(-180)
  const messageState = message?.getAttribute('data-markdown-talvt-render-state') ?? ''
  return [
    section.dataset.turnId ?? section.getAttribute('data-turn-id') ?? '',
    phase,
    label ?? '',
    toolLabel ?? '',
    messageState,
    text.length,
    tail,
  ].join('|')
}

export function readConversationActivity(): Omit<ConversationActivityObservation, 'snapshot'> & {
  active: boolean
  phase: AgentActivityPhase
  turnId: string | null
  label: string | null
  tool: AgentActivitySnapshot['tool']
  fingerprint: string
} {
  const section = latestAssistantTurn()
  const responseState = section
    ?.querySelector<HTMLElement>(RESPONSE_STATE_SELECTOR)
    ?.getAttribute('data-dil-talvt-response-state')
  const status = section?.querySelector<HTMLElement>(STREAM_STATUS_SELECTOR) ?? null
  const statusText = compact(status?.textContent ?? '')
  const toolEvidence = section ? findToolCallEvidence(section)[0] : undefined
  const tool = toolEvidence ? toolInvocationFromEvidence(toolEvidence) : null
  const active = Boolean(
    (section && responseState === 'streaming') ||
      section?.querySelector(ACTIVE_RESPONSE_SELECTOR) ||
      (section && document.querySelector(STOP_SELECTOR)),
  )
  const phase = section ? activityPhase(section, tool, statusText) : 'idle'
  const label = tool?.label ?? (statusText || null)
  return {
    active,
    phase: active ? phase : 'idle',
    turnId: section?.dataset.turnId ?? section?.getAttribute('data-turn-id') ?? null,
    label,
    tool,
    fingerprint: activityFingerprint(section, active ? phase : 'idle', label, tool?.label ?? null),
    section,
    mount: mountTarget(section),
  }
}

export function observeConversationActivity(
  listener: (observation: ConversationActivityObservation) => void,
): ConversationActivityObserver {
  let stopped = false
  let frame = 0
  let activeTurnId: string | null = null
  let startedAt: number | null = null
  let lastActivityAt: number | null = null
  let lastFingerprint = ''
  let lastEmittedKey = ''

  const scan = () => {
    frame = 0
    if (stopped) return
    const now = Date.now()
    const state = readConversationActivity()
    let justCompleted = false
    if (state.active) {
      if (state.turnId !== activeTurnId) {
        activeTurnId = state.turnId
        startedAt = now
        lastActivityAt = now
        lastFingerprint = ''
      }
      if (state.fingerprint !== lastFingerprint) {
        lastFingerprint = state.fingerprint
        lastActivityAt = now
      }
    } else if (activeTurnId !== null) {
      if (state.fingerprint !== lastFingerprint) lastActivityAt = now
      activeTurnId = null
      lastFingerprint = state.fingerprint
      justCompleted = true
    }

    const snapshot: AgentActivitySnapshot = {
      conversationId: currentConversationId() ?? null,
      turnId: state.turnId,
      active: state.active,
      phase: state.active ? state.phase : justCompleted ? 'complete' : 'idle',
      startedAt,
      lastActivityAt,
      durationMs:
        !state.active && justCompleted && startedAt && lastActivityAt
          ? Math.max(0, lastActivityAt - startedAt)
          : null,
      label: state.label,
      tool: state.tool,
    }
    const emittedKey = [
      snapshot.conversationId ?? '',
      snapshot.turnId ?? '',
      snapshot.active ? '1' : '0',
      snapshot.phase,
      snapshot.lastActivityAt ?? '',
      snapshot.label ?? '',
      snapshot.tool?.label ?? '',
    ].join('|')
    if (emittedKey === lastEmittedKey) return
    lastEmittedKey = emittedKey
    listener({ snapshot, section: state.section, mount: state.mount })
  }

  const queue = () => {
    if (stopped || frame) return
    frame = requestAnimationFrame(scan)
  }

  const observer = new MutationObserver((records) => {
    if (
      !records.some((record) => {
        const target =
          record.target instanceof Element ? record.target : record.target.parentElement
        return (
          target?.closest('main') ||
          [...record.addedNodes].some((node) => node instanceof Element && node.closest('main'))
        )
      })
    )
      return
    queue()
  })

  observer.observe(document.body ?? document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'data-dil-talvt-response-state',
      'data-markdown-talvt-render-state',
      'data-testid',
      'data-message-id',
    ],
  })
  queue()

  return {
    scan: queue,
    stop() {
      stopped = true
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    },
  }
}
