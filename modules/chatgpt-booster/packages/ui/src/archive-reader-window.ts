import { buildArchiveThread } from '@chatgpt-booster/chatgpt'
import { ARCHIVE_READER_MAX_RECORDS, mergeArchiveReaderRecords } from '@kobaproduction/browser-archive'
import type { ArchiveThreadWindow } from './mount'

/** Retain adjacent reading context, bounded by records rather than turn size. */
export function mergeArchiveReaderWindows(
  current: ArchiveThreadWindow,
  incoming: ArchiveThreadWindow,
  direction: 'older' | 'newer',
  maximum = ARCHIVE_READER_MAX_RECORDS,
): ArchiveThreadWindow {
  if (
    current.accountId !== incoming.accountId ||
    current.sourceInstanceId !== incoming.sourceInstanceId ||
    current.sourceRevision !== incoming.sourceRevision
  )
    throw Error('archive.error.sourceChanged')
  const recordsOf = (window: ArchiveThreadWindow) =>
    window.thread.turns.flatMap((turn) => [...turn.messages, ...turn.details]).map((item) => item.record)
  const { records, trimmed } = mergeArchiveReaderRecords(
    recordsOf(current),
    recordsOf(incoming),
    direction,
    {
      key: (record) => record.messageId,
      compare: (a, b) =>
        (a.createTime ?? Number.POSITIVE_INFINITY) - (b.createTime ?? Number.POSITIVE_INFINITY) ||
        a.messageId.localeCompare(b.messageId),
      maximum,
    },
  )
  const first = records[0],
    last = records.at(-1)
  return {
    ...incoming,
    thread: buildArchiveThread(records, { unknownTimeLast: true }),
    olderCursor: first ? { messageId: first.messageId, sourceCreateTime: first.createTime } : null,
    newerCursor: last ? { messageId: last.messageId, sourceCreateTime: last.createTime } : null,
    hasOlderStored: direction === 'older' ? incoming.hasOlderStored : current.hasOlderStored || trimmed,
    hasNewerStored: direction === 'newer' ? incoming.hasNewerStored : current.hasNewerStored || trimmed,
    loadedRecordCount: records.length,
    hasUnsequencedRecords: records.some((record) => record.createTime === null),
  }
}
