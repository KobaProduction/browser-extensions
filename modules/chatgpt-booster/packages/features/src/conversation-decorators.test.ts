import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as chatgpt from '@chatgpt-booster/chatgpt'
import * as core from '@chatgpt-booster/core'
import { Window } from 'happy-dom'
import ts from 'typescript'
import { ArchiveSourceGate } from './archive-source-contract'
import { ConversationStateStore } from './conversation-state'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop()
})
type Model = {
  id?: string
  tool?: core.ToolInvocationView
  sentAt?: number | null
  visibleText?: string
  metadata?: { sentAt?: number | null; raw?: { id?: string } }
}
/** Run the actual module with neutral presentation ports, not a duplicate source-selection helper. */
async function setup() {
  const dom = new Window({ url: 'https://chatgpt.com/c/source-chat' })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    CustomEvent: globalThis.CustomEvent,
  }
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    CustomEvent: dom.CustomEvent,
  })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  dom.document.body.innerHTML = `<main><div data-turn-key="native-turn" data-content-search-turn-key="native-turn">
    <div data-chatgpt-search-unit-key="user:user" data-chatgpt-search-message-ids="unkeyed-user"><div data-user-message-bubble="true">DOM user</div></div>
    <div data-chatgpt-search-unit-key="answer:assistant" data-chatgpt-search-message-ids="keyed-answer"><div data-chatgpt-selection-message-id="keyed-answer">DOM answer</div><div class="turn-action-controls opacity-0">Native hover actions</div></div>
    <div class="group/activity-header"><img><span>Unrelated DOM tool label</span></div>
  </div></main>`
  const state = new ConversationStateStore(dom as unknown as globalThis.Window, new ArchiveSourceGate())
  state.ingestAccount({ accountId: 'owner-A', observedAt: 1 })
  let saved = core.normalizeSettings({
    features: {
      messageMetadata: true,
      toolInspector: true,
      activityIndicator: false,
      requestTimer: false,
    } as never,
    monitoring: { intervalMs: 0 },
  })
  let listener: ((next: core.BoosterSettings) => void) | undefined
  const settings = {
    get: async () => saved,
    subscribe(next: typeof listener) {
      listener = next
      return () => {
        listener = undefined
      }
    },
  }
  const mounted = new Map<HTMLElement, { kind: string; model: Model }>()
  const mount = (kind: string) => (into: HTMLElement, model: Model) => {
    const element = dom.document.createElement('span') as unknown as HTMLElement
    into.append(element)
    mounted.set(element, { kind, model })
    return {
      element,
      update(next: Model) {
        mounted.set(element, { kind, model: next })
      },
      tick() {},
      unmount() {
        mounted.delete(element)
        element.remove()
      },
    }
  }
  let scan: (() => void) | undefined
  const imports: Record<string, unknown> = {
    '@chatgpt-booster/chatgpt': {
      ...chatgpt,
      observeConversationDecorations(
        callback: (targets: chatgpt.ConversationMessageTarget[], root: ParentNode) => void,
      ) {
        scan = () => callback(chatgpt.findConversationMessageTargets(), document)
        return { scan, stop() {} }
      },
      observeConversationActivity: () => ({ scan() {}, stop() {} }),
    },
    '@chatgpt-booster/core': core,
    '@chatgpt-booster/ui': {
      resolveLocale: () => 'en',
      mountMessageMetadata: mount('metadata'),
      mountToolInspector: mount('tool'),
      mountAgentActivity: mount('activity'),
      mountRequestStatus: mount('status'),
      mountWorkModeWarning: mount('warning'),
    },
    './conversation-state': { ConversationStateStore },
  }
  let source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    readFileSync(new URL('conversation-decorators.ts', import.meta.url), 'utf8'),
  )
  const tree = ts.createSourceFile(
    'decorators.js',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  for (const declaration of [...tree.statements].reverse()) {
    if (!ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier))
      continue
    const module = JSON.stringify(declaration.moduleSpecifier.text),
      bindings = declaration.importClause?.namedBindings
    const values =
      bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map(
            (item) =>
              `const ${item.name.text}=imports[${module}][${JSON.stringify(item.propertyName?.text ?? item.name.text)}];`,
          )
        : []
    source =
      source.slice(0, declaration.getStart(tree)) + values.join('\n') + source.slice(declaration.end)
  }
  source = source.replace(
    'export class ConversationDecoratorsModule',
    'class ConversationDecoratorsModule',
  )
  const Module = new Function('imports', `${source}\nreturn ConversationDecoratorsModule;`)(imports)
  const module = new Module(settings, undefined, state)
  cleanup.push(() => module.stop())
  await module.start()
  return {
    dom,
    state,
    mounted,
    scan: () => scan?.(),
    update(patch: core.BoosterSettingsPatch) {
      saved = core.mergeSettings(saved, patch)
      listener?.(saved)
    },
  }
}
function sourceRecords(
  state: ConversationStateStore,
  resultParent = 'source-call',
  reasoningTitle?: string,
  thoughtParent?: string,
) {
  const record = (id: string, role: string, metadata: Record<string, unknown>, recipient = 'all') => ({
    id,
    author: { role, metadata: {} },
    create_time: 1_700_000_000,
    update_time: null,
    weight: 1,
    channel: null,
    content: { content_type: 'text', parts: [role === 'tool' ? 'source result' : 'source body'] },
    status: 'finished_successfully',
    end_turn: role === 'assistant' && recipient === 'all',
    recipient,
    metadata,
  })
  state.ingestPage({
    kind: 'conversation-page',
    accountId: 'owner-A',
    conversationId: 'source-chat',
    readId: 'read',
    readStartedAt: 1,
    isInitial: true,
    requestedBefore: null,
    timestamp: 2,
    sourceUrl: 'https://chatgpt.com/backend-api/conversations/source-chat',
    payload: {
      conversation_id: 'source-chat',
      title: 'Synthetic',
      messages: [
        record('unkeyed-user', 'user', {}),
        record('keyed-answer', 'assistant', { turn_exchange_id: 'exact-turn' }),
        record(
          'source-call',
          'assistant',
          {
            turn_exchange_id: 'exact-turn',
            connector_tool_payload: '{"argument":"source only"}',
            ...(reasoningTitle ? { reasoning_title: reasoningTitle } : {}),
          },
          'functions.exec',
        ),
        record('source-result', 'tool', { turn_exchange_id: 'exact-turn', parent_id: resultParent }),
        record(
          'not-this-turn',
          'assistant',
          { turn_exchange_id: 'another-turn', working_turn_id: 'exact-turn' },
          'unrelated.tool',
        ),
        record('unlinked-result', 'tool', { turn_exchange_id: 'exact-turn', parent_id: 'unknown-call' }),
        ...(thoughtParent
          ? [
              {
                ...record('source-summary', 'assistant', {
                  turn_exchange_id: 'exact-turn',
                  parent_id: thoughtParent,
                }),
                content: {
                  content_type: 'thoughts',
                  thoughts: [
                    {
                      summary: 'Source thought summary',
                      content: 'Source reasoning',
                      chunks: [],
                      finished: true,
                    },
                  ],
                  source_analysis_msg_id: null,
                },
              },
            ]
          : []),
      ],
      page_info: {
        start_cursor: null,
        end_cursor: null,
        has_previous_page: false,
        has_next_page: false,
      },
    },
  })
}

test('DOM alone mounts nothing; source records never create a separate tool menu or decorate unrelated summaries', async () => {
  const f = await setup()
  f.scan()
  expect(f.mounted.size).toBe(0)
  sourceRecords(f.state)
  f.scan()
  const tools = [...f.mounted.values()].filter((value) => value.kind === 'tool')
  expect(tools).toHaveLength(0)
  expect(f.dom.document.querySelector('[class~="group/activity-header"]')?.children).toHaveLength(2)
  expect(f.dom.document.querySelector('[data-chatgpt-booster="source-tools"]')).toBeNull()
  expect([...f.mounted.values()].filter((value) => value.kind === 'metadata')).toHaveLength(2)
})

test('tool preference disable and owner revocation unmount source-backed controls synchronously', async () => {
  const f = await setup()
  sourceRecords(f.state)
  f.dom.document
    .querySelector('[data-turn-key]')
    ?.insertAdjacentHTML('afterbegin', '<div data-call-id="source-call"></div>')
  f.scan()
  expect([...f.mounted.values()].some((value) => value.kind === 'tool')).toBe(true)
  f.update({ features: { toolInspector: false } })
  expect([...f.mounted.values()].some((value) => value.kind === 'tool')).toBe(false)
  expect(f.dom.document.querySelector('[data-chatgpt-booster="source-tools"]')).toBeNull()
  f.state.ingestAccount({ accountId: 'owner-B', observedAt: 3 })
  expect(f.mounted.size).toBe(0)
  f.scan()
  expect(f.mounted.size).toBe(0)
})

test('tool results without an explicit parent never attach by timestamp or DOM title/order', async () => {
  const f = await setup()
  sourceRecords(f.state, 'unknown-call')
  f.dom.document
    .querySelector('[data-turn-key]')
    ?.insertAdjacentHTML('afterbegin', '<div data-call-id="source-call"></div>')
  f.scan()
  const tool = [...f.mounted.values()].find((value) => value.kind === 'tool')
  expect(tool?.model.tool?.result).toBeNull()
})

test('reconciling unchanged source tools does not mutate light DOM and retrigger placement observation', async () => {
  const f = await setup()
  sourceRecords(f.state)
  f.scan()
  const host = f.dom.document.querySelector('[data-turn-key]')
  if (!host) throw Error('Expected source turn presentation')
  let mutations = 0
  const observer = new f.dom.MutationObserver((records) => {
    mutations += records.length
  })
  observer.observe(host, { childList: true, subtree: true })
  cleanup.push(() => observer.disconnect())
  f.scan()
  await f.dom.happyDOM.waitUntilComplete()
  expect(mutations).toBe(0)
})

test('an exact native action ID places its source inspector on that action', async () => {
  const f = await setup()
  sourceRecords(f.state)
  f.scan()
  const section = f.dom.document.querySelector('[data-turn-key]')
  if (!section) throw Error('Expected native turn')
  const action = f.dom.document.createElement('div')
  action.setAttribute('data-call-id', 'source-call')
  action.textContent = 'Native label is unrelated to the source tool'
  section.prepend(action)
  f.scan()
  const tools = [...f.mounted.entries()].filter(([, value]) => value.kind === 'tool')
  expect(tools).toHaveLength(1)
  expect(action.contains(tools[0]?.[0] as Node)).toBe(true)
  expect(tools[0]?.[1].model.id).toBe('source-call')
  expect(tools[0]?.[1].model.tool?.payload).toEqual({ argument: 'source only' })
})

test('unknown, conflicting and multi-message native IDs never match by title or order; recycled slots revoke old bindings', async () => {
  const f = await setup()
  sourceRecords(f.state)
  const section = f.dom.document.querySelector('[data-turn-key]')
  if (!section) throw Error('Expected native turn')
  section.insertAdjacentHTML(
    'afterbegin',
    `
    <div data-call-id="unknown-call">functions.exec source only</div>
    <div data-call-id="source-call" data-message-id="not-this-turn">functions.exec</div>
    <div data-chatgpt-search-message-ids="source-call source-result">functions.exec</div>
    <div data-call-id="not-this-turn">another exchange</div>`,
  )
  f.scan()
  expect([...f.mounted.values()].filter((value) => value.kind === 'tool')).toHaveLength(0)
  const action = f.dom.document.querySelector('[data-call-id="unknown-call"]')
  if (!action) throw Error('Expected native action')
  action.setAttribute('data-call-id', 'source-call')
  f.scan()
  expect([...f.mounted.values()].filter((value) => value.kind === 'tool')).toHaveLength(1)
  action.setAttribute('data-call-id', 'unknown-call')
  f.scan()
  expect([...f.mounted.values()].filter((value) => value.kind === 'tool')).toHaveLength(0)
})

test('a hidden native action revokes its inspector', async () => {
  const f = await setup()
  sourceRecords(f.state)
  f.dom.document
    .querySelector('[data-turn-key]')
    ?.insertAdjacentHTML('afterbegin', '<div data-call-id="source-call"></div>')
  f.scan()
  const action = f.dom.document.querySelector<HTMLElement>('[data-call-id="source-call"]')
  if (!action) throw Error('Expected native action')
  action.hidden = true
  f.scan()
  expect([...f.mounted.values()].filter((value) => value.kind === 'tool')).toHaveLength(0)
})

test('legacy native summary placement retains the exact source action ID and revokes a changed row', async () => {
  const f = await setup()
  sourceRecords(f.state, 'source-call', 'Exact native summary')
  const row = f.dom.document.querySelector<HTMLElement>('[class~="group/activity-header"]')
  const label = row?.querySelector('span')
  if (!row || !label) throw Error('Expected native summary row')
  label.textContent = 'Exact native summary'
  f.scan()
  const tools = [...f.mounted.entries()].filter(([, value]) => value.kind === 'tool')
  expect(tools).toHaveLength(1)
  expect(row.contains(tools[0]?.[0] as Node)).toBe(true)
  expect(tools[0]?.[1].model.id).toBe('source-call')
  expect(tools[0]?.[1].model.tool?.payload).toEqual({ argument: 'source only' })
  expect(
    [...f.mounted.entries()].some(
      ([element, value]) => value.kind === 'metadata' && row.contains(element),
    ),
  ).toBe(false)
  expect(tools[0]?.[1].model.metadata?.sentAt).toBeDefined()
  label.textContent = 'Changed native summary'
  f.scan()
  expect([...f.mounted.values()].filter((value) => value.kind === 'tool')).toHaveLength(0)
})

test('thought summary keeps its own metadata identity and links an inspector only by source parent', async () => {
  const f = await setup()
  sourceRecords(f.state, 'source-call', undefined, 'source-call')
  const row = f.dom.document.querySelector<HTMLElement>('[class~="group/activity-header"]')
  const label = row?.querySelector('span')
  if (!row || !label) throw Error('Expected summary')
  label.textContent = 'Source thought summary'
  f.scan()
  expect([...f.mounted.values()].find((value) => value.kind === 'tool')?.model.id).toBe('source-call')
  const tool = [...f.mounted.values()].find((value) => value.kind === 'tool')
  expect(tool?.model.metadata?.raw?.id).toBe('source-summary')
  expect(
    [...f.mounted.entries()].some(
      ([element, value]) => row.contains(element) && value.kind === 'metadata',
    ),
  ).toBe(false)
})

test('an unlinked thought summary receives its date without borrowing a neighboring call', async () => {
  const f = await setup()
  sourceRecords(f.state, 'source-call', undefined, 'unknown-parent')
  const row = f.dom.document.querySelector<HTMLElement>('[class~="group/activity-header"]')
  const label = row?.querySelector('span')
  if (!row || !label) throw Error('Expected summary')
  label.textContent = 'Source thought summary'
  f.scan()
  expect([...f.mounted.values()].filter((value) => value.kind === 'tool')).toHaveLength(0)
  expect(
    [...f.mounted.entries()].some(
      ([element, value]) => row.contains(element) && value.kind === 'metadata',
    ),
  ).toBe(true)
})

test('a linked summary keeps exactly one control through tool preference changes', async () => {
  const f = await setup()
  sourceRecords(f.state, 'source-call', 'One source summary')
  const row = f.dom.document.querySelector<HTMLElement>('[class~="group/activity-header"]')
  const label = row?.querySelector('span')
  if (!row || !label) throw Error('Expected summary row')
  label.textContent = 'One source summary'
  const controls = () =>
    [...f.mounted.entries()].filter(([element]) => row.contains(element)).map(([, value]) => value.kind)
  f.scan()
  expect(controls()).toEqual(['tool'])
  f.update({ features: { toolInspector: false } })
  expect(controls()).toEqual(['metadata'])
  f.update({ features: { toolInspector: true } })
  expect(controls()).toEqual(['tool'])
})

test('visibility ancestor caching is limited to one synchronous placement pass', async () => {
  const f = await setup()
  const root = f.dom.document.createElement('div'),
    child = f.dom.document.createElement('span')
  root.append(child)
  f.dom.document.body.append(root)
  const original = f.dom.getComputedStyle.bind(f.dom)
  let calls = 0
  f.dom.getComputedStyle = ((element) => {
    calls++
    return original(element)
  }) as typeof f.dom.getComputedStyle
  chatgpt.withChatGptPlacementVisibility(() => {
    expect(chatgpt.isChatGptPlacementVisible(child as unknown as HTMLElement)).toBe(true)
    const first = calls
    expect(chatgpt.isChatGptPlacementVisible(child as unknown as HTMLElement)).toBe(true)
    expect(calls).toBe(first)
  })
  root.hidden = true
  expect(chatgpt.isChatGptPlacementVisible(child as unknown as HTMLElement)).toBe(false)
})
