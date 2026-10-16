import { type ArchivePageSelection, type ArchiveScanMode } from './linear-selection'
/** Cursor accounting for one descending, linear archive run. Domain/provider payload stays opaque. */
export interface LinearScanState {
  readonly offset: number
  readonly matched: number
  readonly scanned: number
  readonly newCount: number
}
export interface LinearArchiveSource<T> {
  /** Provider adapter validates native data/auth and returns a descending page. */
  readPage(
    offset: number,
    count: number,
  ): Promise<{
    items: readonly T[]
    count: number
  }>
}
export interface LinearArchiveCommit<T> {
  readonly selection: ArchivePageSelection<T>
  readonly previous: LinearScanState
  readonly next: LinearScanState
  readonly sourceTotal: number
}
export interface LinearScanOptions<T> {
  readonly source: LinearArchiveSource<T>
  readonly mode: ArchiveScanMode
  readonly target: number
  readonly pageSize: number
  readonly knownKeys: Set<string>
  readonly keyOf: (record: T) => string
  readonly timestampOf?: (record: T) => number | null
  readonly fromInclusive?: number | null
  readonly toExclusive?: number | null
  readonly initial: LinearScanState
  /** Source data and durable checkpoint are the caller's responsibility. No next page before this resolves. */
  readonly commit: (page: LinearArchiveCommit<T>) => Promise<void>
  readonly stopped: () => boolean
  readonly delay?: () => Promise<void>
}
export interface LinearScanResult {
  readonly state: LinearScanState
  readonly sourceTotal: number | null
  readonly paused: boolean
  readonly exhausted: boolean
}
/** Orchestrates a linear source only; does not infer ChatGPT branches/verification or implement storage. */
export declare function scanLinearArchive<T>(options: LinearScanOptions<T>): Promise<LinearScanResult>
