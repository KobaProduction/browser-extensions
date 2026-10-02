export interface ToolCallEvidence {
  id: string
  element: HTMLElement
  label: string
  kind: 'mcp' | 'tool'
  timestamp?: string
  structuredPayloads: string[]
  attributes: Record<string, string>
  visibleText: string
  score: number
  signals: string[]
}

const CANDIDATE_SELECTOR = [
  '[data-testid*="tool" i]',
  '[data-testid*="mcp" i]',
  '[data-testid*="connector" i]',
  '[aria-label*="tool" i]',
  '[aria-label*="mcp" i]',
  '[aria-label*="connector" i]',
  'button',
  '[role="button"]',
  'details',
].join(',')

const TOOL_WORDS = /\b(tool|tools|mcp|connector|function|computer|browser|python|terminal)\b/i
const TOOL_ACTIONS =
  /\b(called|calling|used|using|ran|running|searched|searching|executed|executing)\b/i

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function relevantAttributes(element: HTMLElement): Record<string, string> {
  const result: Record<string, string> = {}
  for (const attribute of element.attributes) {
    if (
      attribute.name.startsWith('data-') ||
      attribute.name.startsWith('aria-') ||
      attribute.name === 'role' ||
      attribute.name === 'title'
    )
      result[attribute.name] = attribute.value
  }
  return result
}

function extractTimestamp(element: HTMLElement): string | undefined {
  const localTime = element.querySelector('time')
  if (localTime) {
    const value = localTime.getAttribute('datetime') ?? compact(localTime.textContent ?? '')
    if (value) return value
  }

  const turn = element.closest('article, [data-message-author-role]')
  const turnTime = turn?.querySelector('time')
  if (turnTime) {
    const value = turnTime.getAttribute('datetime') ?? compact(turnTime.textContent ?? '')
    if (value) return value
  }

  for (const node of [element, ...(turn ? [turn] : [])]) {
    if (!(node instanceof HTMLElement)) continue
    for (const key of ['data-timestamp', 'data-time', 'data-start-time', 'data-created-at']) {
      const value = node.getAttribute(key)
      if (value) return value
    }
  }
  return undefined
}

function structuredPayloads(element: HTMLElement): string[] {
  const values = new Set<string>()
  for (const node of element.querySelectorAll('pre, code, [data-json], [data-payload]')) {
    const text = compact(node.textContent ?? '')
    if (text.length >= 2) values.add(text)
  }
  for (const key of ['data-json', 'data-payload']) {
    const value = element.getAttribute(key)
    if (value) values.add(value)
  }
  return [...values].slice(0, 8)
}

function scoreCandidate(element: HTMLElement): { score: number; signals: string[] } {
  const signals: string[] = []
  let score = 0
  const text = compact(element.innerText || element.textContent || '').slice(0, 800)
  const metadata = [
    element.getAttribute('data-testid'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('role'),
    element.className,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')

  if (TOOL_WORDS.test(metadata)) {
    score += 3
    signals.push('tool-like metadata')
  }
  if (TOOL_WORDS.test(text)) {
    score += 2
    signals.push('tool-like text')
  }
  if (TOOL_ACTIONS.test(text)) {
    score += 2
    signals.push('tool action text')
  }
  if (element.querySelector('pre, code, [data-json], [data-payload]')) {
    score += 2
    signals.push('structured descendant')
  }
  const inAssistantTurn = Boolean(
    element.closest('[data-message-author-role="assistant"], article'),
  )
  const hasStructuredPayload = Boolean(
    element.querySelector('pre, code, [data-json], [data-payload]'),
  )
  const isSpecificIntegration = /\b(mcp|connector)\b/i.test(metadata)

  if (inAssistantTurn) {
    score += 1
    signals.push('assistant turn')
  }

  if (!inAssistantTurn && !hasStructuredPayload && !isSpecificIntegration) {
    return { score: 0, signals: [] }
  }

  return { score, signals }
}

function isNestedDuplicate(element: HTMLElement, accepted: HTMLElement[]): boolean {
  return accepted.some((parent) => parent.contains(element) || element.contains(parent))
}

function hashString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash
}

export function findToolCallEvidence(root: ParentNode = document): ToolCallEvidence[] {
  const candidates = [...root.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)]
  const accepted: HTMLElement[] = []
  const result: ToolCallEvidence[] = []

  for (const element of candidates) {
    if (element.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue
    const { score, signals } = scoreCandidate(element)
    if (score < 4 || isNestedDuplicate(element, accepted)) continue

    const visibleText = compact(element.innerText || element.textContent || '').slice(0, 4000)
    if (!visibleText) continue

    const metadataText = [
      element.getAttribute('data-testid') ?? '',
      element.getAttribute('aria-label') ?? '',
      element.getAttribute('title') ?? '',
      visibleText,
    ].join(' ')
    const timestamp = extractTimestamp(element)

    accepted.push(element)
    result.push({
      id: `tool-${result.length}-${Math.abs(hashString(metadataText))}`,
      element,
      label: visibleText.split(/\n|\r/)[0]?.slice(0, 140) || 'Tool call',
      kind: /\bmcp\b/i.test(metadataText) ? 'mcp' : 'tool',
      ...(timestamp ? { timestamp } : {}),
      structuredPayloads: structuredPayloads(element),
      attributes: relevantAttributes(element),
      visibleText,
      score,
      signals,
    })
  }
  return result
}
