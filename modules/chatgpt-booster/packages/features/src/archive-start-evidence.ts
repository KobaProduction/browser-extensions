/** Source boundary, independent of message ancestry and database schema version. */
export interface ConversationStartEvidence {
  kind: 'native-create' | 'native-page'
  firstMessageId: string
  sourceId: string
  observedAt: number
}

export function validateConversationStartEvidence(
  value: unknown,
): asserts value is ConversationStartEvidence {
  const item = value as Partial<ConversationStartEvidence> | null
  if (
    !item ||
    !['native-create', 'native-page'].includes(String(item.kind)) ||
    typeof item.firstMessageId !== 'string' ||
    !item.firstMessageId ||
    item.firstMessageId.length > 1024 ||
    typeof item.sourceId !== 'string' ||
    !item.sourceId ||
    item.sourceId.length > 1024 ||
    typeof item.observedAt !== 'number' ||
    !Number.isFinite(item.observedAt) ||
    item.observedAt < 0
  )
    throw Error('Invalid conversation start evidence')
}
