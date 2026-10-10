import type { AgentActivityPhase, AgentActivitySnapshot } from '@chatgpt-booster/core'
import { CHATGPT_DOM_MUTATION_ATTRIBUTES, resolveChatGptDomAdapter } from './chatgpt-dom-adapter'
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

const STOP_SELECTOR = '[data-testid="stop-button"], [data-testid="stop-generation"]'

function compact(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function dedupeRepeatedText(value: string) {
  const text = compact(value)
  if (!text) return ''
  const match = text.match(/^(.{2,}?)\1$/u)
  return match?.[1]?.trim() || text
}

function activityPhase(
  section: HTMLElement,
  tool: ReturnType<typeof toolInvocationFromEvidence> | null,
  statusText: string,
): AgentActivityPhase {
  if (tool) return 'tool'
  if (statusText) return 'thinking'
  const adapter = resolveChatGptDomAdapter(section)
  if (adapter?.assistantMessage(section)) return 'responding'
  return 'thinking'
}

function activityFingerprint(
  section: HTMLElement | null,
  phase: AgentActivityPhase,
  label: string | null,
  toolLabel: string | null,
  active: boolean,
) {
  if (!section) return `${active ? '1' : '0'}|${phase}|${label ?? ''}|${toolLabel ?? ''}`
  const adapter = resolveChatGptDomAdapter(section)
  const message = adapter?.assistantMessage(section) ?? null
  const text = compact(message?.textContent ?? '')
  return [
    adapter?.turnId(section) ?? '',
    adapter?.turnState(section) ?? '',
    active ? '1' : '0',
    phase,
    label ?? '',
    toolLabel ?? '',
    message?.getAttribute('data-markdown-talvt-render-state') ?? '',
    text.length,
    text.slice(-180),
  ].join('|')
}

export function readConversationActivity(): Omit<ConversationActivityObservation, 'snapshot'> & {
  active: boolean
  phase: AgentActivityPhase
  turnId: string | null
  turnState: string | null
  label: string | null
  tool: AgentActivitySnapshot['tool']
  fingerprint: string
} {
  const adapter = resolveChatGptDomAdapter(document)
  const section = adapter?.latestAssistantTurn(document) ?? null
  const turnState = section ? (adapter?.turnState(section) ?? null) : null
  const responseState = section ? adapter?.responseState(section) : null
  const status = section ? (adapter?.activityStatus(section) ?? null) : null
  const statusText = dedupeRepeatedText(status?.textContent ?? '')
  const evidence = section ? findToolCallEvidence(section) : []
  const toolEvidence = status
    ? evidence.find(
        (candidate) =>
          candidate.element === status ||
          candidate.element.contains(status) ||
          status.contains(candidate.element),
      )
    : undefined
  const tool = toolEvidence ? toolInvocationFromEvidence(toolEvidence) : null
  const active = Boolean(
    section &&
      (turnState === 'in_progress' ||
        responseState === 'streaming' ||
        adapter?.isTurnActive(section) ||
        document.querySelector(STOP_SELECTOR)),
  )
  const phase = section ? activityPhase(section, tool, statusText) : 'idle'
  const label = tool?.label ?? (statusText || null)
  return {
    active,
    phase: active ? phase : turnState === 'complete' ? 'complete' : 'idle',
    turnId: section && adapter ? adapter.turnId(section) : null,
    turnState,
    label,
    tool,
    fingerprint: activityFingerprint(section, phase, label, tool?.label ?? null, active),
    section,
    mount: section && adapter ? adapter.activityMount(section) : null,
  }
}

export function observeConversationActivity(
  listener: (observation: ConversationActivityObservation) => void,
): ConversationActivityObserver {
  let stopped = false
  let frame = 0
  let lastEmittedKey = ''
  let lastActiveTurnId: string | null = null

  const scan = () => {
    frame = 0
    if (stopped) return
    const state = readConversationActivity()
    if (state.active && state.turnId) lastActiveTurnId = state.turnId
    const justCompleted =
      !state.active &&
      state.turnId !== null &&
      state.turnId === lastActiveTurnId &&
      state.turnState === 'complete'
    const snapshot: AgentActivitySnapshot = {
      conversationId: currentConversationId() ?? null,
      turnId: state.turnId,
      active: state.active,
      phase: state.active ? state.phase : justCompleted ? 'complete' : state.phase,
      startedAt: null,
      reasoningStartedAt: null,
      phaseStartedAt: null,
      completedAt: null,
      lastActivityAt: null,
      durationMs: null,
      reasoningDurationMs: null,
      label: state.label,
      tool: state.tool,
    }
    const emittedKey = [
      snapshot.conversationId ?? '',
      snapshot.turnId ?? '',
      snapshot.active ? '1' : '0',
      snapshot.phase,
      state.turnState ?? '',
      state.fingerprint,
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
      ...new Set([
        ...CHATGPT_DOM_MUTATION_ATTRIBUTES,
        'data-dil-talvt-response-state',
        'data-markdown-talvt-render-state',
        'data-talvt-turn-state',
        'data-testid',
      ]),
    ],
  })
  queue()

  return {
    scan() {
      lastEmittedKey = ''
      queue()
    },
    stop() {
      stopped = true
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      lastActiveTurnId = null
    },
  }
}
