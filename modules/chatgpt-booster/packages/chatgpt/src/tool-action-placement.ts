import { findChatGptTurnRoot, isChatGptPlacementVisible } from './chatgpt-dom-adapter'

export interface ChatGptToolActionSlot {
  element: HTMLElement
  section: HTMLElement
  /** Presentation identity only. The caller must resolve a verified source record. */
  sourceId: string
}

const identityAttributes = [
  'data-tool-call-id',
  'data-call-id',
  'data-message-id',
  'data-chatgpt-selection-message-id',
  'data-chatgpt-search-message-ids',
] as const
const selector = identityAttributes.map((attribute) => `[${attribute}]`).join(',')

/** A summary/turn containing several IDs is never an individual action slot. */
export function findChatGptToolActionSlots(root: ParentNode): ChatGptToolActionSlot[] {
  const element = (root as Node).nodeType === 1 ? (root as HTMLElement) : null
  const candidates = [
    ...(element?.matches(selector) ? [element] : []),
    ...root.querySelectorAll<HTMLElement>(selector),
  ]
  const slots: ChatGptToolActionSlot[] = []
  for (const candidate of candidates) {
    if (
      candidate.closest('#chatgpt-booster-root, [data-chatgpt-booster]') ||
      !isChatGptPlacementVisible(candidate)
    )
      continue
    const ids = new Set(
      identityAttributes.flatMap((attribute) =>
        (candidate.getAttribute(attribute) ?? '').trim().split(/\s+/).filter(Boolean),
      ),
    )
    if (ids.size !== 1) continue
    const section = findChatGptTurnRoot(candidate)
    const sourceId = ids.values().next().value
    if (section && sourceId) slots.push({ element: candidate, section, sourceId })
  }
  // Native message wrappers can repeat one identity. Use its most specific slot.
  return slots.filter(
    (slot) =>
      !slots.some(
        (other) =>
          other !== slot && other.sourceId === slot.sourceId && slot.element.contains(other.element),
      ),
  )
}
