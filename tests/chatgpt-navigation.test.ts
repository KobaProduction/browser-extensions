import { describe, expect, test } from 'bun:test'
import {
  currentConversationId,
  hasPendingComposerAttachments,
} from '../packages/chatgpt/src/conversation-scroll'

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

describe('ChatGPT composer safety', () => {
  test('detects pending selected files before a collection reload', () => {
    const root = {
      querySelector: () => ({
        querySelector: () => ({ files: { length: 1 } }),
        querySelectorAll: () => [],
      }),
    } as unknown as ParentNode
    expect(hasPendingComposerAttachments(root)).toBe(true)
  })

  test('detects an attachment preview without treating an empty picker as pending', () => {
    const empty = {
      querySelector: () => ({
        querySelector: () => ({ files: { length: 0 } }),
        querySelectorAll: () => [],
      }),
    } as unknown as ParentNode
    expect(hasPendingComposerAttachments(empty)).toBe(false)

    const preview = {
      querySelector: () => ({
        querySelector: () => ({ files: { length: 0 } }),
        querySelectorAll: () => [{ dataset: { testid: 'file-thumbnail' } }],
      }),
    } as unknown as ParentNode
    expect(hasPendingComposerAttachments(preview)).toBe(true)
  })
})
