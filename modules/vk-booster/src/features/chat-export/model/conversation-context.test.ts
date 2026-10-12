import { expect, test } from 'bun:test'
import {
  archiveContextBlock,
  conversationPeerFromLocation,
  conversationPeerFromPath,
} from './conversation-context'

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

test('VK numeric legacy /im?sel peer is accepted only on messenger path', () => {
  expect(conversationPeerFromLocation({ pathname: '/im', search: '?sel=123' })).toBe(123)
  expect(conversationPeerFromLocation({ pathname: '/im/', search: '?sel=2000000045' })).toBe(2000000045)
  expect(conversationPeerFromLocation({ pathname: '/feed', search: '?sel=123' })).toBeNull()
  expect(conversationPeerFromLocation({ pathname: '/im', search: '?sel=c123' })).toBeNull()
  expect(conversationPeerFromLocation({ pathname: '/im', search: '?sel=0' })).toBeNull()
  expect(conversationPeerFromLocation({ pathname: '/im/convo/123', search: '?sel=4' })).toBe(123)
})
