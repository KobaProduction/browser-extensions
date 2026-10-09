import { describe, expect, test } from 'bun:test'
import {
  claimSessionAlert,
  conversationCriticalAlertKey,
  conversationTerminalAlert,
} from '../packages/features/src/conversation-alerts'

describe('conversation terminal alerts', () => {
  test('only autonomous complete maps to the normal completion alert', () => {
    expect(conversationTerminalAlert({ state: 'complete', terminalCause: null })).toBe('complete')
    expect(conversationTerminalAlert({ state: 'stopped', terminalCause: null })).toBeNull()
    expect(conversationTerminalAlert({ state: 'cancelled', terminalCause: null })).toBeNull()
    expect(
      conversationTerminalAlert({ state: 'failed', terminalCause: 'network_error' }),
    ).toBeNull()
    expect(conversationTerminalAlert({ state: 'in_progress', terminalCause: null })).toBeNull()
  })

  test('conversation exhaustion has a dedicated terminal alert', () => {
    expect(
      conversationTerminalAlert({
        state: 'complete',
        terminalCause: 'conversation_too_large',
      }),
    ).toBe('conversation_exhausted')
    expect(
      conversationCriticalAlertKey('chat-1', {
        userMessageId: 'user-1',
        terminalCause: 'conversation_too_large',
      }),
    ).toBe('chat-1:user-1:conversation_too_large')
  })

  test('critical alert claim deduplicates within session storage', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null
      },
      setItem(key: string, value: string) {
        values.set(key, value)
      },
    }
    expect(claimSessionAlert(storage, 'chat:user:conversation_too_large')).toBe(true)
    expect(claimSessionAlert(storage, 'chat:user:conversation_too_large')).toBe(false)
  })
})
