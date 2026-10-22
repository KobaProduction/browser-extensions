import { expect, test } from 'bun:test'
import type { ArchiveItemView } from '@chatgpt-booster/core'
import { archiveReaderDetails } from './archive-reader-details'

test('ordinary reading hides internal context and empty reasoning but retains meaningful actions', () => {
  const items: Pick<ArchiveItemView, 'kind' | 'text'>[] = [
    { kind: 'internal', text: 'Synthetic context' },
    { kind: 'reasoning', text: '   ' },
    { kind: 'reasoning', text: 'Synthetic reasoning summary' },
    { kind: 'tool_call', text: '' },
    { kind: 'tool_result', text: 'Synthetic result' },
  ]
  expect(archiveReaderDetails(items, false)).toEqual(items.slice(2))
  expect(archiveReaderDetails(items, true)).toBe(items)
  expect(items).toHaveLength(5)
})
