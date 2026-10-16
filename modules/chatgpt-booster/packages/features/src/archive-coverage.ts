export interface HistoryPageEvidence {
  readId?: string | undefined
  readStartedAt?: number | undefined
  isInitial?: boolean | undefined
  requestedBefore?: string | null | undefined
  startCursor: string | null
  endCursor: string | null
  hasPreviousPage: boolean | null
  hasNextPage: boolean | null
  observedAt: number
  /** Local manual-run acknowledgement; never a replacement for the native read identity. */
  captureRun?: string | undefined
}
/** Bounded native-read proof independent of the bounded raw-page replay buffer. */
export interface HistoryCoverageCheckpoint {
  initial: HistoryPageEvidence
  frontier: HistoryPageEvidence
  pageCount: number
  pending: HistoryPageEvidence[]
  /** Exact recent cursor guard, independent of full-chain graph validation. */
  recentCursors: string[]
  blocked: boolean
}
export function nativePageEvidence(page: {
  readId?: string | undefined
  readStartedAt?: number | undefined
  isInitial?: boolean | undefined
  requestedBefore?: string | null | undefined
  timestamp: number
  payload: Record<string, unknown>
}): HistoryPageEvidence {
  const info = page.payload.page_info as Record<string, unknown> | undefined
  return {
    readId: page.readId,
    readStartedAt: page.readStartedAt,
    isInitial: page.isInitial,
    requestedBefore: page.requestedBefore,
    startCursor: typeof info?.start_cursor === 'string' ? info.start_cursor : null,
    endCursor: typeof info?.end_cursor === 'string' ? info.end_cursor : null,
    hasPreviousPage: typeof info?.has_previous_page === 'boolean' ? info.has_previous_page : null,
    hasNextPage: typeof info?.has_next_page === 'boolean' ? info.has_next_page : null,
    observedAt: page.timestamp,
  }
}
export function advanceHistoryCoverage(
  previous: HistoryCoverageCheckpoint | undefined,
  page: HistoryPageEvidence,
): HistoryCoverageCheckpoint | undefined {
  let current = previous
  if (page.isInitial && page.readId) {
    const before = current?.initial
    if (before && (page.readStartedAt ?? page.observedAt) < (before.readStartedAt ?? before.observedAt))
      return current
    if (
      before &&
      (page.readStartedAt ?? page.observedAt) === (before.readStartedAt ?? before.observedAt) &&
      page.readId !== before.readId
    )
      return current
    if (
      before &&
      page.readId === before.readId &&
      page.readStartedAt === before.readStartedAt &&
      page.captureRun === before.captureRun
    ) {
      if (
        initialEvidenceScore(page) < initialEvidenceScore(before) ||
        (initialEvidenceScore(page) === initialEvidenceScore(before) &&
          page.observedAt < before.observedAt)
      )
        return current
      if (current && page.startCursor === before.startCursor && page.hasPreviousPage !== false) {
        return connectPendingHistoryCoverage({
          ...current,
          initial: { ...page },
          frontier: current.pageCount === 1 ? { ...page } : current.frontier,
        })
      }
    }
    current = {
      initial: { ...page },
      frontier: { ...page },
      pageCount: 1,
      pending: [],
      recentCursors: page.startCursor ? [page.startCursor] : [],
      blocked: false,
    }
    return current
  }
  if (
    !current ||
    page.readId !== current.initial.readId ||
    page.readStartedAt !== current.initial.readStartedAt ||
    page.captureRun !== current.initial.captureRun ||
    page.requestedBefore == null ||
    current.blocked
  )
    return current
  const frontier = current.frontier
  if (page.requestedBefore === frontier.requestedBefore && !frontier.isInitial) {
    if (page.startCursor !== frontier.startCursor) return { ...current, blocked: true }
    if (
      initialEvidenceScore(page) > initialEvidenceScore(frontier) ||
      (initialEvidenceScore(page) === initialEvidenceScore(frontier) &&
        page.observedAt >= frontier.observedAt)
    )
      current = { ...current, frontier: { ...page } }
    return connectPendingHistoryCoverage(current)
  }
  const pending = current.pending.filter((item) => item.requestedBefore !== page.requestedBefore)
  const prior = current.pending.find((item) => item.requestedBefore === page.requestedBefore)
  pending.push(prior && prior.observedAt > page.observedAt ? prior : page)
  current = { ...current, pending: pending.slice(-96) }
  return connectPendingHistoryCoverage(current)
}
function connectPendingHistoryCoverage(
  checkpoint: HistoryCoverageCheckpoint,
): HistoryCoverageCheckpoint {
  let current = checkpoint
  if (current.blocked) return current
  while (current.frontier.hasPreviousPage === true && current.frontier.startCursor) {
    const next = current.pending.find((item) => item.requestedBefore === current.frontier.startCursor)
    if (!next) break
    if (
      (next.startCursor &&
        (next.startCursor === current.initial.startCursor ||
          current.recentCursors.includes(next.startCursor))) ||
      !Number.isSafeInteger(current.pageCount + 1)
    )
      return { ...current, blocked: true }
    current = {
      ...current,
      frontier: { ...next },
      pageCount: current.pageCount + 1,
      recentCursors: next.startCursor
        ? [...current.recentCursors, next.startCursor].slice(-96)
        : current.recentCursors,
      pending: current.pending.filter((item) => item !== next),
    }
  }
  return current
}
export function checkpointHistoryCoverage(checkpoint: HistoryCoverageCheckpoint | undefined) {
  if (!checkpoint) return historyCoverage([])
  const { initial, frontier, blocked } = checkpoint
  return {
    verified: !blocked && initial.hasNextPage === false && frontier.hasPreviousPage === false,
    startReached: !blocked && frontier.hasPreviousPage === false,
    endReached: !blocked && initial.hasNextPage === false,
    pageCount: checkpoint.pageCount,
    readId: initial.readId ?? null,
    readStartedAt: initial.readStartedAt ?? null,
    observedAt: Math.max(initial.observedAt, frontier.observedAt),
    oldestCursor: frontier.startCursor,
  }
}
export function validateHistoryCoverageCheckpoint(
  value: unknown,
): asserts value is HistoryCoverageCheckpoint {
  const object = (item: unknown): item is Record<string, unknown> =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
  const page = (item: unknown): item is HistoryPageEvidence => {
    if (
      !object(item) ||
      typeof item.readId !== 'string' ||
      !item.readId ||
      !Number.isFinite(item.observedAt) ||
      (item.observedAt as number) < 0
    )
      return false
    if (
      item.readStartedAt !== undefined &&
      (!Number.isFinite(item.readStartedAt) || (item.readStartedAt as number) < 0)
    )
      return false
    if (item.isInitial !== undefined && typeof item.isInitial !== 'boolean') return false
    if (
      item.captureRun !== undefined &&
      (typeof item.captureRun !== 'string' || !item.captureRun || item.captureRun.length > 256)
    )
      return false
    return (
      ['startCursor', 'endCursor', 'requestedBefore'].every(
        (key) =>
          item[key] === null ||
          typeof item[key] === 'string' ||
          (key === 'requestedBefore' && item[key] === undefined),
      ) &&
      ['hasPreviousPage', 'hasNextPage'].every(
        (key) => item[key] === null || typeof item[key] === 'boolean',
      )
    )
  }
  if (
    !object(value) ||
    !page(value.initial) ||
    value.initial.isInitial !== true ||
    !page(value.frontier) ||
    !Number.isSafeInteger(value.pageCount) ||
    (value.pageCount as number) < 1 ||
    !Array.isArray(value.pending) ||
    value.pending.length > 96 ||
    !value.pending.every(page) ||
    typeof value.blocked !== 'boolean' ||
    !Array.isArray(value.recentCursors) ||
    value.recentCursors.length > 96 ||
    value.recentCursors.some((cursor) => typeof cursor !== 'string' || !cursor)
  )
    throw Error('Invalid native history coverage checkpoint')
  const initial = value.initial
  for (const item of [value.frontier, ...value.pending] as HistoryPageEvidence[])
    if (
      item.readId !== initial.readId ||
      item.readStartedAt !== initial.readStartedAt ||
      item.captureRun !== initial.captureRun
    )
      throw Error('Mixed native history coverage checkpoint')
}
/** A bottom page and every before-cursor continuation must belong to one fresh read. */
function initialEvidenceScore(page: HistoryPageEvidence): number {
  return Number(page.hasPreviousPage !== null) + Number(page.hasNextPage !== null)
}

export function historyCoverage(pages: HistoryPageEvidence[]) {
  // Pick the newest initial using the same ordering as the former sort,
  // without sorting or copying every page on each coverage inspection.
  let initial: HistoryPageEvidence | undefined
  for (const candidate of pages) {
    if (!candidate.isInitial || !candidate.readId) continue
    if (
      !initial ||
      (candidate.readStartedAt ?? candidate.observedAt) >
        (initial.readStartedAt ?? initial.observedAt) ||
      ((candidate.readStartedAt ?? candidate.observedAt) ===
        (initial.readStartedAt ?? initial.observedAt) &&
        (initialEvidenceScore(candidate) > initialEvidenceScore(initial) ||
          (initialEvidenceScore(candidate) === initialEvidenceScore(initial) &&
            candidate.observedAt > initial.observedAt)))
    ) {
      initial = candidate
    }
  }
  if (!initial)
    return {
      verified: false,
      startReached: false,
      endReached: false,
      pageCount: 0,
      readId: null,
      readStartedAt: null,
      observedAt: null,
      oldestCursor: null,
    }

  // Each before-cursor identifies the next page in the same read. Newer
  // observations win, just as the former per-step descending sort did.
  const continuations = new Map<string, HistoryPageEvidence>()
  for (const candidate of pages) {
    if (
      candidate.readId !== initial.readId ||
      candidate.isInitial ||
      candidate.requestedBefore == null ||
      // A reused/malformed read ID is not enough to connect two different
      // native request sessions. Optional historical timestamps stay nullable.
      (initial.readStartedAt !== undefined &&
        candidate.readStartedAt !== undefined &&
        candidate.readStartedAt !== initial.readStartedAt)
    )
      continue
    const previous = continuations.get(candidate.requestedBefore)
    if (!previous || candidate.observedAt > previous.observedAt)
      continuations.set(candidate.requestedBefore, candidate)
  }
  let page = initial
  const seen = new Set<string>()
  let count = 1
  while (page.hasPreviousPage === true && page.startCursor && !seen.has(page.startCursor)) {
    seen.add(page.startCursor)
    const previous = continuations.get(page.startCursor)
    if (!previous || previous.startCursor === page.startCursor) break
    page = previous
    count++
  }
  return {
    verified: initial.hasNextPage === false && page.hasPreviousPage === false,
    startReached: page.hasPreviousPage === false,
    endReached: initial.hasNextPage === false,
    pageCount: count,
    readId: initial.readId ?? null,
    readStartedAt: initial.readStartedAt ?? null,
    observedAt: Math.max(initial.observedAt, page.observedAt),
    oldestCursor: page.startCursor,
  }
}
