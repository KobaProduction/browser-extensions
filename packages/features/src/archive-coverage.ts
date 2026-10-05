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
  const initial = pages
    .filter((page) => page.isInitial && page.readId)
    .sort(
      (a, b) =>
        (b.readStartedAt ?? b.observedAt) - (a.readStartedAt ?? a.observedAt) ||
        initialEvidenceScore(b) - initialEvidenceScore(a) ||
        b.observedAt - a.observedAt,
    )[0]
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
  const sameRead = pages.filter((page) => page.readId === initial.readId)
  let page = initial
  const seen = new Set<string>()
  let count = 1
  while (page.hasPreviousPage === true && page.startCursor && !seen.has(page.startCursor)) {
    seen.add(page.startCursor)
    const previous = sameRead
      .filter((candidate) => !candidate.isInitial && candidate.requestedBefore === page.startCursor)
      .sort((a, b) => b.observedAt - a.observedAt)[0]
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
