import type { FixedSnapshot } from './archive-fixed-dexie'

/** Separate observation DTO fields before a codec which rejects shared aliases.
 * Reference graphs inside one original remain untouched and explicitly unsupported. */
export function detachSourceSnapshot(snapshot: FixedSnapshot): FixedSnapshot {
  return {
    ...snapshot,
    raw: structuredClone(snapshot.raw),
    ...(snapshot.normalized ? { normalized: structuredClone(snapshot.normalized) } : {}),
    ...(snapshot.sourceEvents ? { sourceEvents: structuredClone(snapshot.sourceEvents) } : {}),
    ...(snapshot.versions
      ? {
          versions: snapshot.versions.map((version) => ({
            ...version,
            raw: structuredClone(version.raw),
            ...(version.normalized ? { normalized: structuredClone(version.normalized) } : {}),
            ...(version.sourceEvents ? { sourceEvents: structuredClone(version.sourceEvents) } : {}),
          })),
        }
      : {}),
  }
}

export interface ChatGptSourceContext {
  schema: 'chatgpt-source-context.v1'
  requestId: string | null
  turnExchangeId: string | null
  workingTurnId: string | null
  requestedModel: string | null
  resolvedModel: string | null
  status: string | null
  endTurn: boolean | null
  contentType: string | null
  authorName: string | null
}
/** Optional transport/export view, never a persisted primary-model migration. */
export function projectChatGptSourceContext(
  raw: Readonly<Record<string, unknown>>,
): ChatGptSourceContext {
  const object = (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  const text = (value: unknown) => (typeof value === 'string' ? value : null)
  const metadata = object(raw.metadata)
  return {
    schema: 'chatgpt-source-context.v1',
    requestId: text(metadata?.request_id),
    turnExchangeId: text(metadata?.turn_exchange_id),
    workingTurnId: text(metadata?.working_turn_id),
    requestedModel: text(metadata?.model_slug),
    resolvedModel: text(metadata?.resolved_model_slug),
    status: text(raw.status),
    endTurn: typeof raw.end_turn === 'boolean' ? raw.end_turn : null,
    contentType: text(object(raw.content)?.content_type),
    authorName: text(object(raw.author)?.name),
  }
}
