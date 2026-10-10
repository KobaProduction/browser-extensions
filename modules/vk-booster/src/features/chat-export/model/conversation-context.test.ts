import { expect, test } from 'bun:test'
import { archiveContextBlock, conversationPeerFromPath } from './conversation-context'

test('VK conversation pathname parses only a valid positive safe peer ID', () => {
  expect(conversationPeerFromPath('/im/convo/7654321')).toBe(7654321)
  expect(conversationPeerFromPath('/im/convo/7654321/')).toBe(7654321)
  expect(conversationPeerFromPath('/im/convo/0')).toBeNull()
  expect(conversationPeerFromPath('/im/convo/9007199254740993')).toBeNull()
  expect(conversationPeerFromPath('/im/convo/1234-other')).toBeNull()
  expect(conversationPeerFromPath('/im')).toBeNull()
})

test('export is blocked unless the open VK conversation matches the selected folder', () => {
  expect(archiveContextBlock(7654321, 7654321)).toBeNull()
  expect(archiveContextBlock(7654321, null)).toContain('Открой')
  expect(archiveContextBlock(7654321, 2345678)).toContain('другая переписка')
})
