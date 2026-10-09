import { type ArchivePageSelection, type ArchiveScanMode, selectArchivePage } from './linear-selection'

/** Cursor accounting for one descending, linear archive run. Domain/provider payload stays opaque. */
export interface LinearScanState {
  readonly offset: number
  readonly matched: number
  readonly scanned: number
  readonly newCount: number
}

export interface LinearArchiveSource<T> {
  /** Provider adapter validates native data/auth and returns a descending page. */
  readPage(offset: number, count: number): Promise<{ items: readonly T[]; count: number }>
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
export async function scanLinearArchive<T>(options: LinearScanOptions<T>): Promise<LinearScanResult> {
  if (
    !Number.isSafeInteger(options.target) ||
    options.target < 1 ||
    !Number.isSafeInteger(options.pageSize) ||
    options.pageSize < 1 ||
    !Number.isSafeInteger(options.initial.offset) ||
    options.initial.offset < 0 ||
    !Number.isSafeInteger(options.initial.matched) ||
    options.initial.matched < 0 ||
    options.initial.matched > options.target ||
    !Number.isSafeInteger(options.initial.scanned) ||
    options.initial.scanned < 0 ||
    !Number.isSafeInteger(options.initial.newCount) ||
    options.initial.newCount < 0
  )
    throw new Error('Invalid linear archive scan state')

  let state: LinearScanState = { ...options.initial }
  let sourceTotal: number | null = null
  let exhausted = state.matched >= options.target
  while (!options.stopped() && state.matched < options.target) {
    const page = await options.source.readPage(state.offset, options.pageSize)
    if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.count) || page.count < 0)
      throw new Error('Invalid linear archive source page')
    sourceTotal = page.count
    if (!page.items.length || state.offset >= page.count) {
      exhausted = true
      break
    }
    const selection = selectArchivePage({
      mode: options.mode,
      records: page.items,
      knownKeys: options.knownKeys,
      keyOf: options.keyOf,
      timestampOf: options.timestampOf,
      fromInclusive: options.fromInclusive,
      toExclusive: options.toExclusive,
      remaining: options.target - state.matched,
    })
    if (selection.consumed === 0) throw new Error('Linear archive scan made no progress')
    const next: LinearScanState = {
      offset: state.offset + selection.consumed,
      matched: state.matched + selection.matched,
      scanned: state.scanned + selection.consumed,
      newCount: state.newCount + selection.added.length,
    }
    // The repository must acknowledge the page/checkpoint before the cursor or known IDs advance.
    await options.commit({ selection, previous: state, next, sourceTotal: page.count })
    for (const item of selection.added) options.knownKeys.add(options.keyOf(item))
    state = next
    if (
      selection.boundaryReached ||
      state.offset >= page.count ||
      page.items.length < options.pageSize ||
      state.matched >= options.target
    ) {
      exhausted = true
      break
    }
    if (!options.stopped()) await options.delay?.()
  }
  return { state, sourceTotal, paused: options.stopped(), exhausted }
}
