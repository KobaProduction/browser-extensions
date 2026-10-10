/** Portable turn layout. Native record contents belong to provider renderers. */
export interface ArchiveTranscriptRecord {
  key: string
  messageId: string
}
export interface ArchiveTranscriptTurn {
  id: string
  association: 'linked' | 'adjacency' | 'unassigned'
  users: readonly ArchiveTranscriptRecord[]
  details: readonly ArchiveTranscriptRecord[]
  replies: readonly ArchiveTranscriptRecord[]
}
export interface ArchiveTranscriptCopy {
  empty: string
  unassigned: string
  adjacency: string
  details: string
}
