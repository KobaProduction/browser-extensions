import { expect, test } from 'bun:test'
import type { ArchiveCaptureContext } from '@chatgpt-booster/core'
import { Window } from 'happy-dom'
import { mountArchiveScopeControls } from '../../chatgpt/src/archive-scope-controls'
import type { FixedChatGptCapture } from './archive-fixed-runtime'
import { createFixedArchiveUiAdapter } from './archive-fixed-ui-adapter'
import { type ArchiveScopeSource, sourceScopeContext } from './archive-scope-context'
import { ArchiveSourceGate } from './archive-source-contract'
import { ConversationStateStore } from './conversation-state'

const projectA = `g-p-${'a'.repeat(32)}`,
  projectB = `g-p-${'b'.repeat(32)}`
function source(): ArchiveScopeSource {
  const projects = new Map(
    [projectA, projectB].map((projectId) => [projectId, { projectId, title: 'Duplicate' }]),
  )
  return {
    ownerId: 'synthetic-owner',
    nativeConversation: (id) =>
      id === 'source-chat'
        ? { conversationId: id, projectId: projectB, title: 'Native title' }
        : undefined,
    savedConversation: () => undefined,
    savedProject: (id) => projects.get(id),
    currentNativeProjectId: projectB,
  }
}

test('source scope identity ignores duplicate DOM labels and URL project ancestry', () => {
  const evidence = source()
  expect(
    sourceScopeContext(
      { scope: 'conversation', id: 'source-chat', title: 'DOM title', projectId: projectA },
      evidence,
    ),
  ).toEqual({
    scope: 'conversation',
    id: 'source-chat',
    title: 'Native title',
    projectId: projectB,
  })
  expect(sourceScopeContext({ scope: 'project', id: projectA, title: 'Duplicate' }, evidence)?.id).toBe(
    projectA,
  )
  expect(sourceScopeContext({ scope: 'project', id: projectB, title: 'Duplicate' }, evidence)?.id).toBe(
    projectB,
  )
  expect(
    sourceScopeContext({ scope: 'project', id: 'unknown', title: 'Duplicate' }, evidence),
  ).toBeUndefined()
  expect(
    sourceScopeContext(
      { scope: 'project', id: projectA, title: 'Duplicate' },
      { ...evidence, ownerId: null },
    ),
  ).toBeUndefined()
})

test('capture settings current context uses owner-verified native metadata instead of document and sidebar metadata', async () => {
  const dom = new Window({ url: `https://chatgpt.com/g/${projectA}/c/source-chat` })
  const previous = {
    window: globalThis.window,
    location: globalThis.location,
    document: globalThis.document,
  }
  Object.assign(globalThis, { window: dom, location: dom.location, document: dom.document })
  const state = new ConversationStateStore({} as globalThis.Window, new ArchiveSourceGate(true))
  try {
    dom.document.title = 'DOM title'
    dom.document.body.innerHTML = `<nav><a href="/g/${projectA}/project">DOM project title</a></nav>`
    state.ingestAccount({ accountId: 'synthetic-owner', observedAt: 1 })
    state.ingestPage({
      kind: 'conversation-page',
      accountId: 'synthetic-owner',
      conversationId: 'source-chat',
      timestamp: 20,
      readId: 'native-read',
      readStartedAt: 10,
      isInitial: true,
      sourceUrl: 'https://chatgpt.com/backend-api/conversations/source-chat',
      payload: {
        conversation_id: 'source-chat',
        title: 'Native title',
        gizmo_id: projectB,
        gizmo_type: 'snorlax',
        current_node: null,
        messages: [],
        page_info: {
          start_cursor: null,
          end_cursor: null,
          has_previous_page: false,
          has_next_page: false,
        },
      },
    })
    const capture = {
      listSavedConversations: async () => [],
      listSavedProjects: async () => [
        { projectId: projectA, title: 'Native project A' },
        { projectId: projectB, title: 'Native project B' },
      ],
    } as unknown as FixedChatGptCapture
    const adapter = createFixedArchiveUiAdapter(capture, state)
    expect(adapter.currentProjectId()).toBe(projectB)
    expect(await adapter.getCurrentContext()).toEqual({
      conversationId: 'source-chat',
      conversationTitle: 'Native title',
      projectId: projectB,
      projectTitle: 'Native project B',
    })
    state.ingestAccount({ accountId: 'other-owner', observedAt: 30 })
    expect(adapter.currentProjectId()).toBeNull()
    expect(await adapter.getCurrentContext()).toEqual({
      conversationId: null,
      conversationTitle: null,
      projectId: null,
      projectTitle: null,
    })
  } finally {
    state.stop()
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  }
})

test('anonymous duplicate-title project rows get no action; source-confirmed href IDs keep independent targets', async () => {
  const dom = new Window({ url: 'https://chatgpt.com/' })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    MutationObserver: globalThis.MutationObserver,
    Element: globalThis.Element,
    Node: globalThis.Node,
    getComputedStyle: globalThis.getComputedStyle,
  }
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    MutationObserver: dom.MutationObserver,
    Element: dom.Element,
    Node: dom.Node,
    getComputedStyle: dom.getComputedStyle.bind(dom),
  })
  let controls: ReturnType<typeof mountArchiveScopeControls> | undefined
  try {
    const row =
      '<div role="row" data-page-table-selectable-row="true"><div role="gridcell"><div><svg data-testid="project-folder-icon"></svg></div><span>Duplicate</span></div><button aria-label="Actions for &quot;Duplicate&quot;" data-page-table-row-actions-focus-target="true"></button></div>'
    dom.document.body.innerHTML = `<main>${row}${row}</main><nav><li><a href="/g/${projectA}/project">Duplicate</a></li><li><a href="/g/${projectB}/project">Duplicate</a></li></nav>`
    const evidence = source(),
      writes: string[] = [],
      mounted: ArchiveCaptureContext[] = []
    const options = {
      visible: (context: ArchiveCaptureContext) => Boolean(sourceScopeContext(context, evidence)),
      // A stale title-only option must never authorize a row in the adapter.
      resolveProjectContext: () => ({ scope: 'project' as const, id: projectB, title: 'Duplicate' }),
      mount(host: HTMLElement, candidate: ArchiveCaptureContext) {
        const context = sourceScopeContext(candidate, evidence)
        if (!context) throw Error('Unverified synthetic target')
        mounted.push(context)
        const button = dom.document.createElement('button')
        button.onclick = () => {
          writes.push(context.id)
        }
        host.append(button as unknown as globalThis.Node)
        return {
          update() {},
          unmount() {
            button.remove()
          },
        }
      },
    }
    controls = mountArchiveScopeControls(options)
    controls.refresh()
    expect(
      dom.document.querySelectorAll('main [data-chatgpt-booster="archive-scope-control"]'),
    ).toHaveLength(0)
    expect(mounted.map((context) => context.id)).toEqual([projectA, projectB])
    const buttons = dom.document.querySelectorAll<HTMLButtonElement>('nav [data-chatgpt-booster] button')
    buttons[0]?.click()
    expect(writes).toEqual([projectA])
    buttons[1]?.click()
    expect(writes).toEqual([projectA, projectB])
  } finally {
    controls?.stop()
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  }
})
