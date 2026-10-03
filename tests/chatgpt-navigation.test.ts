import { describe, expect, test } from 'bun:test'
import { currentConversationId } from '../packages/chatgpt/src/conversation-scroll'

describe('ChatGPT conversation routing', () => {
  test('extracts conversation id from a root chat URL', () => {
    expect(currentConversationId('https://chatgpt.com/c/conversation-123')).toBe('conversation-123')
  })

  test('extracts conversation id from a project chat URL', () => {
    expect(currentConversationId('https://chatgpt.com/g/g-p-project-123/c/conversation-456')).toBe(
      'conversation-456',
    )
  })
})
