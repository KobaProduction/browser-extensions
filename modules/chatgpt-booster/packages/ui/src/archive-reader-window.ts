import { buildArchiveThread } from '@chatgpt-booster/chatgpt'
import type { ArchiveThreadWindow } from './mount'

/** Retain adjacent reading context, bounded by records rather than turn size. */
export function mergeArchiveReaderWindows(
  current: ArchiveThreadWindow,
  incoming: ArchiveThreadWindow,
  direction: 'older' | 'newer',
  maximum = 320,
): ArchiveThreadWindow {
  if (
    current.accountId !== incoming.accountId ||
    current.sourceInstanceId !== incoming.sourceInstanceId ||
    current.sourceRevision !== incoming.sourceRevision
  )
    throw Error('archive.error.sourceChanged')
  const byId = new Map(
    [...current.thread.turns, ...incoming.thread.turns]
      .flatMap((turn) => [...turn.messages, ...turn.details])
      .map((item) => [item.record.messageId, item.record]),
  )
  const all = [...byId.values()].sort(
    (a, b) =>
      (a.createTime ?? Number.POSITIVE_INFINITY) - (b.createTime ?? Number.POSITIVE_INFINITY) ||
      a.messageId.localeCompare(b.messageId),
  )
  const trimmed = all.length > maximum
  const records = direction === 'older' ? all.slice(0, maximum) : all.slice(-maximum)
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
