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
    pageCount: count,
    readId: initial.readId ?? null,
    readStartedAt: initial.readStartedAt ?? null,
    observedAt: Math.max(initial.observedAt, page.observedAt),
    oldestCursor: page.startCursor,
  }
}
