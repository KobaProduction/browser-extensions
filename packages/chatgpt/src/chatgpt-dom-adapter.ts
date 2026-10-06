export type ChatGptDomContractId = 'legacy-turn-v1' | 'search-unit-v2'

export interface ChatGptMessageTarget {
  section: HTMLElement
  message: HTMLElement
  actions: HTMLElement
  metadataMount: HTMLElement
  messageId: string
  role: 'user' | 'assistant'
  domContract: ChatGptDomContractId
}

export interface ChatGptDomAdapter {
  readonly id: ChatGptDomContractId
  readonly mutationAttributes: readonly string[]
  matches(root: ParentNode): boolean
  findMessageTargets(root: ParentNode): ChatGptMessageTarget[]
  findTurnRoot(element: Element): HTMLElement | null
  findTurnRoots(root: ParentNode): HTMLElement[]
  latestAssistantTurn(root?: ParentNode): HTMLElement | null
  isAssistantTurn(turn: HTMLElement): boolean
  assistantMessage(turn: HTMLElement): HTMLElement | null
  activityStatus(turn: HTMLElement): HTMLElement | null
  responseState(turn: HTMLElement): string | null
  isTurnActive(turn: HTMLElement): boolean
  activityMount(turn: HTMLElement): HTMLElement
  turnId(turn: HTMLElement): string | null
  conversationAnchor(root: ParentNode): HTMLElement | null
  messageIds(turn: HTMLElement): string[]
  messageBounds(root: ParentNode): { firstMessageId: string | null; lastMessageId: string | null }
  scrollHints(root: ParentNode): HTMLElement[]
  toolActivityRows(root: ParentNode): HTMLElement[]
}

const LEGACY_TURN_SELECTOR = 'main section[data-testid^="conversation-turn-"]'
const LEGACY_MESSAGE_SELECTOR = '[data-message-id][data-message-author-role]'
const SEARCH_TURN_SELECTOR = 'main [data-turn-key]'
const SEARCH_UNIT_SELECTOR = '[data-chatgpt-search-unit-key]'
const SEARCH_MESSAGE_IDS = 'data-chatgpt-search-message-ids'
const SEARCH_ASSISTANT_MESSAGE_SELECTOR = '[data-chatgpt-selection-message-id]'
const SEARCH_ACTIVITY_HEADER_SELECTOR = '[class~="group/activity-header"]'
const TURN_ACTIONS_SELECTOR = '.turn-action-controls'

function includeSelf(root: ParentNode, selector: string): HTMLElement[] {
  const result: HTMLElement[] = []
  if (root instanceof HTMLElement && root.matches(selector)) result.push(root)
  result.push(...root.querySelectorAll<HTMLElement>(selector))
  return result
}

function uniqueElements(elements: Iterable<HTMLElement>): HTMLElement[] {
  return [...new Set(elements)]
}

function firstToken(value: string | null | undefined): string | null {
  return value?.trim().split(/\s+/).find(Boolean) ?? null
}

export function searchUnitRole(element: Element): 'user' | 'assistant' | null {
  const key = element.getAttribute('data-chatgpt-search-unit-key') ?? ''
  if (/:user$/.test(key)) return 'user'
  if (/:assistant$/.test(key)) return 'assistant'
  return null
}

export function searchUnitMessageId(element: Element): string | null {
  return firstToken(element.getAttribute(SEARCH_MESSAGE_IDS))
}

function legacyNativeActions(section: HTMLElement): HTMLElement | null {
  const copy = section.querySelector<HTMLElement>('[data-testid="copy-turn-action-button"]')
  if (copy?.parentElement) return copy.parentElement

  const role =
    section.querySelector<HTMLElement>(LEGACY_MESSAGE_SELECTOR)?.dataset.messageAuthorRole
  const selector =
    role === 'user'
      ? 'button[aria-label*="message" i], button[aria-label*="сообщение" i]'
      : 'button[aria-label*="answer" i], button[aria-label*="ответ" i]'
  return section.querySelector<HTMLElement>(selector)?.parentElement ?? null
}

function legacyCotToolRow(icon: HTMLElement): HTMLElement {
  let current: HTMLElement | null = icon
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
    const control = current.querySelector<HTMLElement>('button[aria-controls][aria-label]')
    if (control) return current
  }
  return icon.parentElement ?? icon
}

function searchUnitActions(
  unit: HTMLElement,
  turn: HTMLElement,
  role: 'user' | 'assistant',
): HTMLElement | null {
  if (role === 'user') return unit.querySelector<HTMLElement>(TURN_ACTIONS_SELECTOR)

  const rows = [...turn.querySelectorAll<HTMLElement>(TURN_ACTIONS_SELECTOR)].filter(
    (row) => !row.closest(`${SEARCH_UNIT_SELECTOR}[data-chatgpt-search-unit-key$=":user"]`),
  )
  return rows.at(-1) ?? null
}

function metadataMountForActions(actions: HTMLElement): HTMLElement {
  const more = [...actions.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(
    (button) => /more actions|ещ[её] действия/i.test(button.getAttribute('aria-label') ?? ''),
  )
  return more?.parentElement ?? actions
}

const legacyTurnDomAdapter: ChatGptDomAdapter = {
  id: 'legacy-turn-v1',
  mutationAttributes: ['data-message-id', 'data-message-author-role', 'data-testid'],
  matches(root) {
    if (root instanceof Element && root.closest('section[data-testid^="conversation-turn-"]'))
      return true
    return Boolean(root.querySelector(LEGACY_TURN_SELECTOR))
  },
  findMessageTargets(root) {
    const result: ChatGptMessageTarget[] = []
    for (const section of includeSelf(root, LEGACY_TURN_SELECTOR)) {
      if (section.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue
      const message = section.querySelector<HTMLElement>(LEGACY_MESSAGE_SELECTOR)
      const messageId = message?.dataset.messageId?.trim()
      const rawRole = message?.dataset.messageAuthorRole?.trim()
      const role = rawRole === 'user' || rawRole === 'assistant' ? rawRole : null
      const actions = legacyNativeActions(section)
      const metadataMount =
        section.querySelector<HTMLElement>('[data-conversation-screenshot-content]') ?? actions
      if (!message || !messageId || !role || !actions || !metadataMount) continue
      result.push({
        section,
        message,
        actions,
        metadataMount,
        messageId,
        role,
        domContract: this.id,
      })
    }
    return result
  },
  findTurnRoot(element) {
    return element.closest<HTMLElement>('section[data-testid^="conversation-turn-"]')
  },
  findTurnRoots(root) {
    return includeSelf(root, LEGACY_TURN_SELECTOR)
  },
  latestAssistantTurn(root = document) {
    const turns = this.findTurnRoots(root).filter((turn) => this.isAssistantTurn(turn))
    return turns.at(-1) ?? null
  },
  isAssistantTurn(turn) {
    return Boolean(
      turn.matches('[data-turn="assistant"]') ||
        turn.querySelector('[data-message-author-role="assistant"]'),
    )
  },
  assistantMessage(turn) {
    return turn.querySelector<HTMLElement>('[data-message-author-role="assistant"]')
  },
  activityStatus(turn) {
    return turn.querySelector<HTMLElement>('[data-streaming-response-status]')
  },
  responseState(turn) {
    return (
      turn
        .querySelector<HTMLElement>('[data-dil-talvt-response-state]')
        ?.getAttribute('data-dil-talvt-response-state') ?? null
    )
  },
  isTurnActive(turn) {
    return Boolean(
      this.responseState(turn) === 'streaming' ||
        turn.querySelector(
          '[data-dil-talvt-response-state="streaming"], [data-markdown-talvt-render-state="pending"], .streaming-animation',
        ),
    )
  },
  activityMount(turn) {
    return turn.querySelector<HTMLElement>('[data-conversation-screenshot-content]') ?? turn
  },
  turnId(turn) {
    return turn.dataset.turnId ?? turn.getAttribute('data-turn-id') ?? null
  },
  conversationAnchor(root) {
    return (
      root.querySelector<HTMLElement>(
        'main [data-message-id][data-message-author-role], main [data-testid^="conversation-turn-"]',
      ) ?? null
    )
  },
  messageIds(turn) {
    return uniqueElements(turn.querySelectorAll<HTMLElement>(LEGACY_MESSAGE_SELECTOR))
      .map((message) => message.dataset.messageId?.trim() ?? '')
      .filter(Boolean)
  },
  messageBounds(root) {
    const ids = includeSelf(root, LEGACY_MESSAGE_SELECTOR)
      .filter((element) => {
        const role = element.dataset.messageAuthorRole
        return role === 'user' || role === 'assistant'
      })
      .map((element) => element.dataset.messageId?.trim() ?? '')
      .filter(Boolean)
    return { firstMessageId: ids[0] ?? null, lastMessageId: ids.at(-1) ?? null }
  },
  scrollHints(root) {
    return uniqueElements(
      root.querySelectorAll<HTMLElement>(
        '[class~="group/scroll-root"], [data-scroll-root], [data-testid*="scroll" i]',
      ),
    )
  },
  toolActivityRows(root) {
    const icons = includeSelf(root, '[data-testid="cot-v5-tool-icon-pile"]')
    return uniqueElements(icons.map(legacyCotToolRow))
  },
}

const searchUnitDomAdapter: ChatGptDomAdapter = {
  id: 'search-unit-v2',
  mutationAttributes: [
    'data-turn-key',
    'data-chatgpt-search-unit-key',
    'data-chatgpt-search-message-ids',
    'data-chatgpt-selection-message-id',
    'data-markdown-animated',
    'aria-expanded',
  ],
  matches(root) {
    if (root instanceof Element && root.closest('[data-turn-key]')) return true
    return Boolean(
      root.querySelector(
        '[data-turn-key], [data-chatgpt-search-unit-key], [data-content-search-turn-key]',
      ),
    )
  },
  findMessageTargets(root) {
    const result: ChatGptMessageTarget[] = []
    for (const unit of includeSelf(root, SEARCH_UNIT_SELECTOR)) {
      if (unit.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue
      const role = searchUnitRole(unit)
      if (!role) continue
      const section = unit.closest<HTMLElement>('[data-turn-key]')
      if (!section) continue

      const message =
        role === 'user'
          ? (unit.querySelector<HTMLElement>('[data-user-message-bubble="true"]') ?? unit)
          : (unit.querySelector<HTMLElement>(SEARCH_ASSISTANT_MESSAGE_SELECTOR) ?? unit)
      const messageId =
        (role === 'assistant'
          ? message.getAttribute('data-chatgpt-selection-message-id')?.trim()
          : null) ?? searchUnitMessageId(unit)
      if (!messageId) continue

      const actions = searchUnitActions(unit, section, role)
      if (!actions) continue
      const metadataMount = metadataMountForActions(actions)
      result.push({
        section,
        message,
        actions,
        metadataMount,
        messageId,
        role,
        domContract: this.id,
      })
    }
    return result
  },
  findTurnRoot(element) {
    return element.closest<HTMLElement>('[data-turn-key]')
  },
  findTurnRoots(root) {
    return includeSelf(root, SEARCH_TURN_SELECTOR)
  },
  latestAssistantTurn(root = document) {
    const turns = this.findTurnRoots(root).filter((turn) => this.isAssistantTurn(turn))
    return turns.at(-1) ?? null
  },
  isAssistantTurn(turn) {
    return Boolean(
      turn.querySelector(
        `${SEARCH_UNIT_SELECTOR}[data-chatgpt-search-unit-key$=":assistant"], ${SEARCH_ASSISTANT_MESSAGE_SELECTOR}, ${SEARCH_ACTIVITY_HEADER_SELECTOR}`,
      ),
    )
  },
  assistantMessage(turn) {
    return (
      turn.querySelector<HTMLElement>(SEARCH_ASSISTANT_MESSAGE_SELECTOR) ??
      turn.querySelector<HTMLElement>(
        `${SEARCH_UNIT_SELECTOR}[data-chatgpt-search-unit-key$=":assistant"] [data-markdown-text-style="assistant-message"]`,
      )
    )
  },
  activityStatus(turn) {
    const headers = turn.querySelectorAll<HTMLElement>(SEARCH_ACTIVITY_HEADER_SELECTOR)
    return headers.item(headers.length - 1) ?? null
  },
  responseState(turn) {
    return this.isTurnActive(turn) ? 'streaming' : null
  },
  isTurnActive(turn) {
    return Boolean(
      turn.querySelector(
        '[data-markdown-animated], [class*="cadencedShimmer"], [data-streaming-response-status]',
      ),
    )
  },
  activityMount(turn) {
    const status = this.activityStatus(turn)
    if (status?.parentElement) return status.parentElement
    const actionRows = [...turn.querySelectorAll<HTMLElement>(TURN_ACTIONS_SELECTOR)]
    return actionRows.at(-1) ?? turn
  },
  turnId(turn) {
    return turn.dataset.turnKey?.trim() || null
  },
  conversationAnchor(root) {
    return root.querySelector<HTMLElement>(
      'main [data-turn-key], main [data-chatgpt-search-unit-key]',
    )
  },
  messageIds(turn) {
    const ids = new Set<string>()
    for (const unit of turn.querySelectorAll<HTMLElement>(SEARCH_UNIT_SELECTOR)) {
      const role = searchUnitRole(unit)
      if (!role) continue
      const id =
        (role === 'assistant'
          ? unit
              .querySelector<HTMLElement>(SEARCH_ASSISTANT_MESSAGE_SELECTOR)
              ?.getAttribute('data-chatgpt-selection-message-id')
              ?.trim()
          : null) ?? searchUnitMessageId(unit)
      if (id) ids.add(id)
    }
    return [...ids]
  },
  messageBounds(root) {
    const ids: string[] = []
    for (const unit of includeSelf(root, SEARCH_UNIT_SELECTOR)) {
      const role = searchUnitRole(unit)
      if (!role) continue
      const id =
        (role === 'assistant'
          ? unit
              .querySelector<HTMLElement>(SEARCH_ASSISTANT_MESSAGE_SELECTOR)
              ?.getAttribute('data-chatgpt-selection-message-id')
              ?.trim()
          : null) ?? searchUnitMessageId(unit)
      if (id && ids.at(-1) !== id) ids.push(id)
    }
    return { firstMessageId: ids[0] ?? null, lastMessageId: ids.at(-1) ?? null }
  },
  scrollHints(root) {
    return uniqueElements(
      root.querySelectorAll<HTMLElement>(
        '.thread-scroll-container, [data-scroll-root], [data-testid*="scroll" i]',
      ),
    )
  },
  toolActivityRows(root) {
    return includeSelf(root, SEARCH_ACTIVITY_HEADER_SELECTOR).filter(
      (row) => !row.querySelector('button[aria-expanded]') && Boolean(row.querySelector('img')),
    )
  },
}

const adapters: readonly ChatGptDomAdapter[] = [searchUnitDomAdapter, legacyTurnDomAdapter]

export function chatGptDomAdapters(): readonly ChatGptDomAdapter[] {
  return adapters
}

export function resolveChatGptDomAdapter(
  root: ParentNode = document,
): ChatGptDomAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(root))
}

export function findChatGptTurnRoot(element: Element): HTMLElement | null {
  for (const adapter of adapters) {
    const turn = adapter.findTurnRoot(element)
    if (turn) return turn
  }
  return null
}

export function findChatGptTurnRoots(root: ParentNode): HTMLElement[] {
  return uniqueElements(adapters.flatMap((adapter) => adapter.findTurnRoots(root)))
}

export function isAssistantChatGptTurn(turn: HTMLElement): boolean {
  const adapter = resolveChatGptDomAdapter(turn)
  return adapter?.isAssistantTurn(turn) ?? false
}

export function chatGptTurnMessageIds(turn: HTMLElement): string[] {
  const adapter = resolveChatGptDomAdapter(turn)
  return adapter?.messageIds(turn) ?? []
}

export function chatGptTurnId(turn: HTMLElement): string | null {
  const adapter = resolveChatGptDomAdapter(turn)
  return adapter?.turnId(turn) ?? null
}

export function chatGptConversationAnchor(root: ParentNode = document): HTMLElement | null {
  return resolveChatGptDomAdapter(root)?.conversationAnchor(root) ?? null
}

export function chatGptMessageBounds(root: ParentNode = document): {
  firstMessageId: string | null
  lastMessageId: string | null
} {
  return (
    resolveChatGptDomAdapter(root)?.messageBounds(root) ?? {
      firstMessageId: null,
      lastMessageId: null,
    }
  )
}

export function chatGptScrollHints(root: ParentNode = document): HTMLElement[] {
  return resolveChatGptDomAdapter(root)?.scrollHints(root) ?? []
}

export function chatGptToolActivityRows(root: ParentNode): HTMLElement[] {
  return resolveChatGptDomAdapter(root)?.toolActivityRows(root) ?? []
}

export const CHATGPT_DOM_MUTATION_ATTRIBUTES = [
  ...new Set(adapters.flatMap((adapter) => [...adapter.mutationAttributes])),
]
