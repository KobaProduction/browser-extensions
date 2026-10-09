import type { ArchiveItemView, ArchiveTurnView } from '@chatgpt-booster/core'
import type {
  ArchiveTranscriptRecord,
  ArchiveTranscriptTurn,
} from '@kobaproduction/browser-widgets'

/** Restricts ChatGPT turn/branch semantics to a projection the shared view can render. */
export function projectArchiveTranscript(turns: readonly ArchiveTurnView[]): {
  turns: ArchiveTranscriptTurn[]
  byKey: ReadonlyMap<string, ArchiveItemView>
} {
  const byKey = new Map<string, ArchiveItemView>()
  const project = (items: readonly ArchiveItemView[]): ArchiveTranscriptRecord[] =>
    items.map((item) => {
      byKey.set(item.record.messageKey, item)
      return { key: item.record.messageKey, messageId: item.record.messageId }
    })
  return {
    turns: turns.map((turn) => ({
      id: turn.id,
      association:
        turn.association === 'adjacency'
          ? 'adjacency'
          : turn.association === 'unassigned'
            ? 'unassigned'
            : 'linked',
      users: project(turn.messages.filter((item) => item.kind === 'user')),
      details: project(turn.details),
      replies: project(turn.messages.filter((item) => item.kind !== 'user')),
    })),
    byKey,
  }
}
