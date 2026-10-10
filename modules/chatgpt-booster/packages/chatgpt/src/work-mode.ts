export type ChatGptWorkConversationOrigin = 'tpp' | 'flora'

export function isChatGptWorkConversationOrigin(
  value: unknown,
): value is ChatGptWorkConversationOrigin {
  return value === 'tpp' || value === 'flora'
}
