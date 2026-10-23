import type { ArchiveConversationIntegrity } from '@kobaproduction/browser-archive'

export interface ArchiveIntegrityStatusInput {
  integrity?: ArchiveConversationIntegrity | null | undefined
  complete?: boolean | undefined
  hasOlderHistory?: boolean | null | undefined
  loading?: boolean | undefined
  error?: boolean | undefined
}

/** Completeness needs both source coverage and a verified graph, never just row counts. */
export function archiveIntegrityStatus(input: ArchiveIntegrityStatusInput) {
  const integrity = input.integrity
  const gaps = integrity?.issues.filter((issue) => issue.reason !== 'unverified-root').length ?? 0
  const missingStart = input.hasOlderHistory === true
  const missingEnd = integrity?.end === 'missing'
  const complete = Boolean(
    input.complete &&
      integrity?.start === 'verified' &&
      integrity.end === 'verified' &&
      integrity.chain === 'verified' &&
      integrity.issues.length === 0 &&
      !missingStart,
  )
  const state = input.loading
    ? 'loading'
    : input.error
      ? 'error'
      : gaps || integrity?.chain === 'gaps' || missingStart || missingEnd
        ? 'partial'
        : complete
          ? 'complete'
          : 'unknown'
  return {
    state,
    gaps,
    missingStart,
    missingEnd,
    start: integrity?.start ?? 'unknown',
    end: integrity?.end ?? 'unknown',
    chain: integrity?.chain ?? 'unknown',
  } as const
}
