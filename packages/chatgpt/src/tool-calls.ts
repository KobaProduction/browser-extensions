import type { ArchiveRecordView, ToolInvocationView } from '@chatgpt-booster/core'

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

const HIGH_SIGNAL_SELECTOR = [
  '[data-testid*="tool" i]',
  '[data-testid*="mcp" i]',
  '[data-testid*="connector" i]',
  '[aria-label*="tool" i]',
  '[aria-label*="mcp" i]',
  '[aria-label*="connector" i]',
  '[data-json]',
  '[data-payload]',
  'pre',
  'code',
].join(',')

const ASSISTANT_TURN_SELECTOR = [
  '[data-message-author-role="assistant"]',
  '[data-turn="assistant"]',
  '[data-author="assistant"]',
].join(',')

const EXCLUDED_UI_SELECTOR = [
  'nav',
  'aside',
  'header',
  'footer',
  'form',
  '[data-testid*="sidebar" i]',
  '[data-testid*="composer" i]',
  '[aria-label*="sidebar" i]',
  '[aria-label*="navigation" i]',
].join(',')

const TOOL_WORDS = /\b(tool|tools|mcp|connector|function|computer|browser|python|terminal)\b/i
const TOOL_ACTIONS =
  /\b(called|calling|used|using|ran|running|searched|searching|executed|executing)\b/i

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function assistantTurn(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>(ASSISTANT_TURN_SELECTOR)
}

function isInsideConversationAssistantTurn(element: HTMLElement): boolean {
  const turn = assistantTurn(element)
  if (!turn) return false
  if (element.closest(EXCLUDED_UI_SELECTOR)) return false

  const main = element.closest('main')
  return Boolean(main || turn.closest('main'))
}

function relevantAttributes(element: HTMLElement): Record<string, string> {
  const result: Record<string, string> = {}
  for (const attribute of element.attributes) {
    if (
      attribute.name.startsWith('data-') ||
      attribute.name.startsWith('aria-') ||
      attribute.name === 'role' ||
      attribute.name === 'title'
    ) {
      result[attribute.name] = attribute.value
    }
  }
  return result
}

function extractTimestamp(element: HTMLElement): string | undefined {
  const localTime = element.querySelector('time')
  if (localTime) {
    const value = localTime.getAttribute('datetime') ?? compact(localTime.textContent ?? '')
    if (value) return value
  }

  const turn = assistantTurn(element)
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
  if (!isInsideConversationAssistantTurn(element)) return { score: 0, signals: [] }

  const signals: string[] = ['assistant conversation turn']
  let score = 2
  const text = compact(element.textContent || '').slice(0, 800)
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
  const searchRoot = root === document ? (document.querySelector('main') ?? document) : root
  const rootElement = searchRoot instanceof Element ? searchRoot : undefined
  const highSignal =
    rootElement?.matches(HIGH_SIGNAL_SELECTOR) || searchRoot.querySelector(HIGH_SIGNAL_SELECTOR)
  if (!highSignal) {
    const text = compact(searchRoot.textContent ?? '').slice(0, 1600)
    if (!TOOL_WORDS.test(text) && !TOOL_ACTIONS.test(text)) return []
  }

  const candidates = [...searchRoot.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)]
  const accepted: HTMLElement[] = []
  const result: ToolCallEvidence[] = []

  for (const element of candidates) {
    if (element.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue
    const { score, signals } = scoreCandidate(element)
    if (score < 5 || isNestedDuplicate(element, accepted)) continue

    const visibleText = compact(element.textContent || '').slice(0, 4000)
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

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function firstNonEmptyString(...values: unknown[]): string | null {
  return (
    values.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ??
    null
  )
}

function safeHttpUrl(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    try {
      const url = new URL(value)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
    } catch {}
  }
  return null
}

function nestedToolName(value: unknown): string | null {
  const seen = new Set<unknown>()
  const visit = (input: unknown, depth: number): string | null => {
    if (depth > 5 || seen.has(input)) return null
    if (typeof input === 'string') {
      const direct = input.match(/\btools\.([A-Za-z0-9_]+)\s*\(/)?.[1]
      if (direct) return direct
      return input.match(/\b(mcp__[A-Za-z0-9_]+__[A-Za-z0-9_]+)\b/)?.[1] ?? null
    }
    if (!input || typeof input !== 'object') return null
    seen.add(input)
    const values = Array.isArray(input) ? input : Object.values(input as Record<string, unknown>)
    for (const item of values) {
      const result = visit(item, depth + 1)
      if (result) return result
    }
    return null
  }
  return visit(value, 0)
}

function cleanSegment(value: string) {
  return value
    .replace(/^mcp__/, '')
    .replace(/^github_(?:agent|reviewer)_/, '')
    .replace(/^gitlab_/, '')
    .replace(/^browser_/, '')
    .replace(/^devtools_/, '')
    .replaceAll('__', ' · ')
    .replaceAll('_', ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitToolName(raw: string): { provider: string | null; action: string | null } {
  if (raw.startsWith('mcp__')) {
    const value = raw.slice('mcp__'.length)
    const split = value.indexOf('__')
    if (split > 0)
      return {
        provider: cleanSegment(value.slice(0, split)),
        action: cleanSegment(value.slice(split + 2)),
      }
  }
  const parts = raw.split(/[./:]/).filter(Boolean)
  if (parts.length > 1)
    return {
      provider: parts.slice(0, -1).map(cleanSegment).filter(Boolean).join(' · '),
      action: cleanSegment(parts.at(-1) ?? ''),
    }
  return { provider: null, action: cleanSegment(raw) || null }
}

function observedToolIconUrl(value: unknown, depth = 0): string | null {
  if (depth > 3) return null
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return value
    try {
      const url = new URL(value)
      const host = url.hostname.toLowerCase()
      const trusted =
        host === 'chatgpt.com' ||
        host.endsWith('.chatgpt.com') ||
        host === 'openai.com' ||
        host.endsWith('.openai.com') ||
        host === 'oaistatic.com' ||
        host.endsWith('.oaistatic.com') ||
        (host === 'www.google.com' && url.pathname === '/s2/favicons')
      if (url.protocol === 'https:' && trusted) return url.href
    } catch {}
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = observedToolIconUrl(item, depth + 1)
      if (result) return result
    }
    return null
  }
  const object = asObject(value)
  if (!object) return null
  for (const key of ['url', 'icon_url', 'iconUrl', 'src', 'light', 'dark', 'default']) {
    const result = observedToolIconUrl(object[key], depth + 1)
    if (result) return result
  }
  for (const item of Object.values(object)) {
    const result = observedToolIconUrl(item, depth + 1)
    if (result) return result
  }
  return null
}

function toolIconKey(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && !first.includes('://') && !first.startsWith('data:')
    ? first.toLowerCase()
    : null
}

export function toolInvocationFromRecord(record: ArchiveRecordView): ToolInvocationView | null {
  const metadata = asObject(record.raw.metadata)
  const recipient = record.recipient?.trim() || null
  const payload =
    metadata?.arguments ??
    metadata?.args ??
    metadata?.input ??
    record.raw.arguments ??
    record.raw.args ??
    record.raw.input ??
    null
  const rawName =
    nestedToolName(payload ?? record.raw) ??
    firstNonEmptyString(
      metadata?.tool_title,
      metadata?.tool_name,
      metadata?.connector_name,
      metadata?.app_name,
      metadata?.name,
      record.authorName,
      recipient && recipient !== 'all' ? recipient : null,
    )
  if (!rawName && record.role !== 'tool') return null
  const name = rawName ?? 'tool'
  const parts = splitToolName(name)
  const provider = parts.provider
  const action = parts.action
  const label = provider ? provider + ' · ' + (action ?? 'tool') : (action ?? 'Tool')
  const icons = metadata?.tool_icons ?? metadata?.tool_icon
  return {
    kind: /^mcp__/.test(name) || /\bmcp\b/i.test(provider ?? '') ? 'mcp' : 'tool',
    provider,
    action,
    label,
    recipient,
    timestamp: record.createTime ?? record.firstSeenAt ?? null,
    payload,
    link: safeHttpUrl(
      metadata?.tool_url,
      metadata?.connector_url,
      metadata?.app_url,
      metadata?.source_url,
    ),
    iconUrl: observedToolIconUrl(icons),
    iconKey: toolIconKey(icons),
  }
}

export function toolInvocationFromEvidence(evidence: ToolCallEvidence): ToolInvocationView {
  const rawName =
    nestedToolName(evidence.structuredPayloads) ??
    evidence.attributes['data-tool-name'] ??
    evidence.attributes['data-testid'] ??
    evidence.label
  const parts = splitToolName(rawName)
  return {
    kind: evidence.kind,
    provider: parts.provider,
    action: parts.action,
    label: parts.provider
      ? parts.provider + ' · ' + (parts.action ?? evidence.label)
      : (parts.action ?? evidence.label),
    recipient: null,
    timestamp: evidence.timestamp ? Date.parse(evidence.timestamp) || null : null,
    payload:
      evidence.structuredPayloads.length === 1
        ? evidence.structuredPayloads[0]
        : evidence.structuredPayloads,
    link: null,
    iconUrl: null,
    iconKey: null,
  }
}
