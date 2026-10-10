/** Archive navigation view models; independent of a provider, project or DB. */
export interface ArchiveConversationRow {
  id: string
  title: string
  depth: number
  branched: boolean
  sourceMissing: boolean
}

export interface ArchiveConversationGroup {
  id: string
  label: string
  count: number
  rows: readonly ArchiveConversationRow[]
}

export interface ArchiveConversationListCopy {
  search: string
  loading: string
  empty: string
  noResults: string
  untitled: string
  missingBranch: string
}
