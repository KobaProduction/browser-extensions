import { expect, test } from 'bun:test'
import {
  type ArchiveExportMessageSummary,
  archiveExportSelectionIds,
  defaultArchiveExportSelection,
} from './export-selection'

const messages: ArchiveExportMessageSummary[] = [
  {
    id: 'end',
    timestampMs: new Date(2025, 9, 10, 23, 59, 59, 999).getTime(),
    author: 'Synthetic',
    text: 'end of day',
  },
  { id: 'first', timestampMs: new Date(2025, 9, 9, 0).getTime(), author: 'Synthetic', text: 'first' },
  { id: 'later', timestampMs: new Date(2025, 9, 11, 0).getTime(), author: 'Synthetic', text: 'later' },
  { id: 'unknown', timestampMs: null, author: 'Synthetic', text: 'no date' },
]
test('date selection includes both local calendar days, excludes the following day and never fabricates unknown dates', () => {
  expect(
    archiveExportSelectionIds(messages, {
      ...defaultArchiveExportSelection(),
      mode: 'dates',
      fromDate: '2025-10-09',
      throughDate: '2025-10-10',
    }),
  ).toEqual(['end', 'first'])
  expect(() =>
    archiveExportSelectionIds(messages, {
      ...defaultArchiveExportSelection(),
      mode: 'dates',
      fromDate: '2025-02-30',
    }),
  ).toThrow('Некорректная дата')
  expect(() =>
    archiveExportSelectionIds(messages, {
      ...defaultArchiveExportSelection(),
      mode: 'dates',
      fromDate: '2025-10-11',
      throughDate: '2025-10-09',
    }),
  ).toThrow('Начало периода')
})
test('latest N follows source timestamps rather than IDs or metadata insertion order; explicit selections stay explicit', () => {
  expect(
    archiveExportSelectionIds(messages, {
      ...defaultArchiveExportSelection(),
      mode: 'last',
      lastCount: 2,
    }),
  ).toEqual(['end', 'later'])
  expect(archiveExportSelectionIds(messages, defaultArchiveExportSelection())).toBeUndefined()
  expect(
    archiveExportSelectionIds(messages, { ...defaultArchiveExportSelection(), mode: 'selected' }, [
      'unknown',
      'unknown',
    ]),
  ).toEqual(['unknown'])
  expect(() =>
    archiveExportSelectionIds(messages, {
      ...defaultArchiveExportSelection(),
      mode: 'last',
      lastCount: 0,
    }),
  ).toThrow()
})
