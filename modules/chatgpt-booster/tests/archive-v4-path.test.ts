import { describe, expect, test } from 'bun:test'
import {
  type ArchiveV4Message,
  traceArchiveV4Path,
  traceArchiveV4PathIds,
} from '../packages/features/src/archive-v4-store'

function node(id: string, parent: string | null, parentKnown = true): ArchiveV4Message {
  return {
    key: id,
    conversationKey: 'one-account-one-conversation',
    messageId: id,
    parentId: parent,
    parentKnown,
    sourceCreateTime: null,
    firstSeenAt: 1,
    lastSeenAt: 1,
    revision: 1,
    raw: {},
  }
}

const root = node('root', null)
const tip = node('tip', 'root')
const lookup = (nodes: ArchiveV4Message[]) => async (id: string) =>
  nodes.find((item) => item.messageId === id)

describe('archive v4 verified lineage', () => {
  test('keeps only genuine parent links in root-to-tip order', async () => {
    const result = await traceArchiveV4Path('tip', lookup([root, tip]))
    expect(result.status).toBe('verified')
    expect(result.rootId).toBe('root')
    expect(result.messages.map((item) => item.messageId)).toEqual(['root', 'tip'])
  })

  test('ID-only verified path retains the exact chain but not raw messages', async () => {
    const ids = await traceArchiveV4PathIds('tip', lookup([root, tip]))
    expect(ids).toEqual({ status: 'verified', messageIds: ['root', 'tip'], rootId: 'root' })
    const unknown = await traceArchiveV4PathIds('tip', lookup([tip]))
    expect(unknown.status).toBe('missing_parent')
    expect(unknown.rootId).toBeNull()
  })

  test('never fabricates a missing parent or an unknown root', async () => {
    const missing = await traceArchiveV4Path('tip', lookup([tip]))
    expect(missing.status).toBe('missing_parent')
    expect(missing.rootId).toBeNull()
    const unknown = await traceArchiveV4Path('tip', lookup([node('tip', null, false)]))
    expect(unknown.status).toBe('parent_unknown')
    expect(unknown.rootId).toBeNull()
  })

  test('stops explicit path traversal after cancellation', async () => {
    const controller = new AbortController()
    const result = traceArchiveV4Path(
      'tip',
      async (id) => {
        controller.abort()
        return lookup([root, tip])(id)
      },
      100,
      controller.signal,
    )
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('rejects cycles and a truncated path without claiming completeness', async () => {
    const cyclic = await traceArchiveV4Path(
      'tip',
      lookup([node('tip', 'root'), node('root', 'tip')]),
    )
    expect(cyclic.status).toBe('cyclic_parent')
    const limited = await traceArchiveV4Path('tip', lookup([root, tip]), 1)
    expect(limited.status).toBe('depth_limit')
  })
})
