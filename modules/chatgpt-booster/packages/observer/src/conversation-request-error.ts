function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Native response evidence only. HTTP 413 alone is not a context-limit signal. */
export function conversationRequestErrorCode(
  payload: unknown,
  status: number,
  fallback: 'request_rejected' | 'network_error' = 'request_rejected',
): string {
  const error = object(payload),
    nested = object(error?.error),
    detail = object(error?.detail)
  const code = error?.code ?? error?.error_code ?? nested?.code
  if (
    code === 'conversation_too_large' ||
    code === 'tokenless_resume_unavailable' ||
    code === 'persisted_final_available'
  )
    return code
  // Observed native composer failure on 2026-10-22. Do not infer this from
  // translated DOM text, a generic payload-size error or a failed network call.
  if (
    status === 413 &&
    detail?.code === 'conversation_length_exceeds_limit' &&
    typeof detail.message === 'string'
  )
    return 'conversation_too_large'
  return fallback
}
