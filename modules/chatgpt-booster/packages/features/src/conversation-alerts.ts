import type { ConversationLifecycleSnapshot } from './conversation-state'

export type ConversationTerminalAlert = 'complete' | 'conversation_exhausted' | null

const SESSION_ALERTS_KEY = 'chatgpt-booster:terminal-alerts:v1'
const MAX_SESSION_ALERTS = 48

export function conversationTerminalAlert(
  lifecycle: Pick<ConversationLifecycleSnapshot, 'state' | 'terminalCause'>,
): ConversationTerminalAlert {
  if (lifecycle.terminalCause === 'conversation_too_large') return 'conversation_exhausted'
  if (lifecycle.state === 'complete' && lifecycle.terminalCause === null) return 'complete'
  return null
}

export function conversationCriticalAlertKey(
  conversationId: string,
  lifecycle: Pick<ConversationLifecycleSnapshot, 'userMessageId' | 'terminalCause'>,
): string | null {
  if (lifecycle.terminalCause !== 'conversation_too_large' || !lifecycle.userMessageId) return null
  return [conversationId, lifecycle.userMessageId, lifecycle.terminalCause].join(':')
}

export function claimSessionAlert(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  alertKey: string,
): boolean {
  try {
    const raw = storage.getItem(SESSION_ALERTS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    const existing = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
    if (existing.includes(alertKey)) return false
    storage.setItem(
      SESSION_ALERTS_KEY,
      JSON.stringify([...existing.slice(-(MAX_SESSION_ALERTS - 1)), alertKey]),
    )
    return true
  } catch {
    return true
  }
}
