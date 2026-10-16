import { expect, test } from 'bun:test'
import {
  type ArchiveMessageV1,
  archiveMessageKey,
  archiveMessageText,
  resolveArchiveMessage,
  validateArchiveMessage,
} from './message-model'

function message(): ArchiveMessageV1 {
  const identity = {
    providerId: 'synthetic',
    ownerId: 'owner',
    conversationId: 'conversation',
    messageId: 'message',
  }
  return {
    schema: 'koba.message',
    modelVersion: 1,
    key: archiveMessageKey(identity),
    identity,
    author: { id: null, role: null, name: null },
    time: { createdAtMs: null, updatedAtMs: null, observedAtMs: 1234 },
    links: { parentId: null, parentObserved: false, replyToId: null, threadId: null },
    context: {
      channel: null,
      recipient: null,
      status: null,
      endTurn: null,
      projectId: null,
      requestId: null,
      turnExchangeId: null,
      workingTurnId: null,
      requestedModel: null,
      resolvedModel: null,
      direction: null,
    },
    content: {
      coverage: 'contains-opaque',
      elements: [
        {
          id: 'root',
          parentId: null,
          order: 0,
          kind: 'opaque',
          visibility: 'unknown',
          text: null,
          language: null,
          sourcePath: 'future',
        },
      ],
    },
    evidence: { terminal: 'unknown' },
    source: { snapshotKey: 'synthetic-source', kind: 'synthetic', version: 'v1', variantIndex: null },
  }
}
test('the common identity separates providers/owners and does not narrow native ID length', () => {
  const input = message(),
    identity = { ...input.identity, messageId: 'legal-native-id'.repeat(300) }
  expect(
    validateArchiveMessage({ ...input, identity, key: archiveMessageKey(identity) }).identity.messageId,
  ).toBe(identity.messageId)
  expect(archiveMessageKey({ ...identity, providerId: 'other' })).not.toBe(archiveMessageKey(identity))
  expect(() => validateArchiveMessage(input, { ...input.identity, ownerId: 'other' })).toThrow(
    'identity',
  )
})
test('large content trees validate iteratively while self-parent, cycles and missing parents fail', () => {
  const input = message(),
    elements = Array.from({ length: 20000 }, (_, index) => ({
      id: String(index),
      parentId: index ? String(index - 1) : null,
      order: 0,
      kind: 'container' as const,
      visibility: 'unknown' as const,
      text: null,
      language: null,
      sourcePath: '',
    }))
  expect(
    validateArchiveMessage({ ...input, content: { coverage: 'typed', elements } }).content.elements,
  ).toHaveLength(20000)
  for (const malformed of [
    [{ ...elements[0], parentId: '0' }],
    [
      { ...elements[0], parentId: '1' },
      { ...elements[1], parentId: '0' },
    ],
    [{ ...elements[0], parentId: 'missing' }],
  ])
    expect(() =>
      validateArchiveMessage({ ...input, content: { coverage: 'typed', elements: malformed } }),
    ).toThrow()
})
test('stored authority is source-checked, unknown versions fail and unknown evidence is never invented', () => {
  const input = message()
  expect(resolveArchiveMessage(undefined, input)).toBe(input)
  const stored = structuredClone(input)
  expect(resolveArchiveMessage(stored, input)).toBe(stored)
  expect(() =>
    resolveArchiveMessage({ ...stored, author: { ...stored.author, role: 'assistant' } }, input),
  ).toThrow('source evidence')
  expect(() => validateArchiveMessage({ ...stored, modelVersion: 99 })).toThrow('version')
  expect(archiveMessageText(stored)).toBe('')
  expect(stored.links.parentObserved).toBe(false)
  expect(stored.evidence.terminal).toBe('unknown')
})
