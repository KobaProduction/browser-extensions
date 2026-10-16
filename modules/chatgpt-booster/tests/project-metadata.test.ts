import { afterEach, expect, test } from 'bun:test'
import { mergeSettings, normalizeSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { Window } from 'happy-dom'
import { ArchiveCollectionSession } from '../packages/features/src/archive-collection-session'
import { FixedCanonicalDexieRepository } from '../packages/features/src/archive-fixed-dexie'
import { FixedChatGptCapture } from '../packages/features/src/archive-fixed-runtime'
import { ConversationStateStore } from '../packages/features/src/conversation-state'
import {
  CONVERSATION_ACCOUNT_EVENT,
  CONVERSATION_CATALOG_EVENT,
  type ConversationAccountEventDetail,
  type ConversationCatalogEventDetail,
  installTransportObserver,
  projectCatalogFromPayload,
} from '../packages/observer/src'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const url = 'https://chatgpt.com/backend-api/gizmos/g-p-synthetic'
const payload = {
  gizmo: {
    id: 'g-p-synthetic',
    display: { name: 'Synthetic project' },
    gizmo_type: 'snorlax',
    instructions: 'Synthetic ignored instructions',
    files: [{ name: 'Synthetic ignored file' }],
    tools: [{ type: 'synthetic-ignored-tool' }],
  },
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5))
function installDom(name: string) {
  const dom = new Window({ url: `https://chatgpt.com/c/${name}` })
  const previous = {
    window: globalThis.window,
    location: globalThis.location,
    document: globalThis.document,
    CustomEvent: globalThis.CustomEvent,
  }
  Object.assign(globalThis, {
    window: dom,
    location: dom.location,
    document: dom.document,
    CustomEvent: dom.CustomEvent,
  })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  return dom
}

test('native project parser admits exact source identity/name and excludes instructions/files/tools', () => {
  expect(projectCatalogFromPayload(url, payload, 1)).toEqual({
    items: [],
    projects: [{ projectId: 'g-p-synthetic', title: 'Synthetic project' }],
    observedAt: 1,
  })
  for (const [source, body] of [
    [url.replace('g-p-synthetic', 'g-p-other'), payload],
    [url.replace('chatgpt.com', 'example.test'), payload],
    [url.replace('g-p-synthetic', 'g-custom'), { gizmo: { ...payload.gizmo, id: 'g-custom' } }],
    [url, { gizmo: { ...payload.gizmo, display: { name: null } } }],
    [url, { gizmo: { ...payload.gizmo, display: { name: 'x'.repeat(4097) } } }],
  ] as const)
    expect(projectCatalogFromPayload(source, body, 1)).toBeNull()
})

test('actual fetch project response requires a successful same-owner read and drops a read spanning account switch', async () => {
  installDom('project-observer')
  const state = new ConversationStateStore(window)
  let resolveDelayed: (response: Response) => void = () => undefined
  let delayed = false
  let registry = ['owner-A']
  let projectStatus = 200
  class Xhr extends EventTarget {
    open() {}
    send() {}
  }
  class Socket extends EventTarget {
    send() {}
  }
  class Events extends EventTarget {}
  const catalogs: ConversationCatalogEventDetail[] = []
  const target = Object.assign(new EventTarget(), {
    location: new URL('https://chatgpt.com/c/project-observer'),
    XMLHttpRequest: Xhr,
    WebSocket: Socket,
    EventSource: Events,
    async fetch(input: RequestInfo | URL) {
      const source = String(input)
      if (source.includes('/accounts/check'))
        return Response.json({
          accounts: Object.fromEntries(registry.map((id) => [id, { account: { account_id: id } }])),
        })
      if (source.endsWith('/conversations')) return Response.json({ items: [] })
      if (delayed)
        return new Promise<Response>((resolve) => {
          resolveDelayed = resolve
        })
      return Response.json(payload, { status: projectStatus })
    },
    postMessage(message: { type: string; detail: unknown }) {
      if (message.type === CONVERSATION_ACCOUNT_EVENT)
        state.ingestAccount(message.detail as ConversationAccountEventDetail)
      if (message.type === CONVERSATION_CATALOG_EVENT) {
        const detail = message.detail as ConversationCatalogEventDetail
        catalogs.push(detail)
        state.ingestCatalog(detail)
      }
    },
  }) as unknown as globalThis.Window & typeof globalThis
  const dispose = installTransportObserver(target)
  cleanup.push(dispose)
  await target.fetch('https://chatgpt.com/backend-api/accounts/check')
  await tick()
  expect(state.verifiedAccountId()).toBe('owner-A')
  await target.fetch(url, { headers: { 'chatgpt-account-id': 'owner-A' } })
  await tick()
  expect(state.project('g-p-synthetic')?.title).toBe('Synthetic project')
  expect(catalogs[0]?.projects).toEqual([{ projectId: 'g-p-synthetic', title: 'Synthetic project' }])
  const count = catalogs.length
  await target.fetch(url, { headers: { 'chatgpt-account-id': 'owner-B' } })
  await target.fetch(url, { method: 'POST' })
  projectStatus = 500
  await target.fetch(url)
  projectStatus = 200
  await tick()
  expect(catalogs).toHaveLength(count)
  delayed = true
  const pending = target.fetch(url, { headers: { 'chatgpt-account-id': 'owner-A' } })
  registry = ['owner-A', 'owner-B']
  await target.fetch('https://chatgpt.com/backend-api/conversations', {
    headers: { 'chatgpt-account-id': 'owner-B' },
  })
  await target.fetch('https://chatgpt.com/backend-api/accounts/check')
  await tick()
  expect(state.verifiedAccountId()).toBe('owner-B')
  expect(state.listProjects()).toEqual([])
  resolveDelayed(Response.json(payload))
  await pending
  await tick()
  expect(state.listProjects()).toEqual([])
  expect(catalogs).toHaveLength(count)
})

test('project RAM survives capture off, persists only with consent and rejects stale/wrong-owner updates', async () => {
  installDom('project-persistence')
  const state = new ConversationStateStore(window)
  state.ingestAccount({ accountId: 'synthetic-project-owner', observedAt: 1 })
  let stored = mergeSettings(normalizeSettings(), { archive: { defaultRule: { enabled: false } } })
  const listeners = new Set<(settings: typeof stored) => void>()
  const settings: SettingsAdapter = {
    get: async () => structuredClone(stored),
    async set(next) {
      stored = normalizeSettings(next)
      for (const listener of listeners) listener(stored)
    },
    async update(patch) {
      stored = mergeSettings(stored, patch)
      for (const listener of listeners) listener(stored)
      return stored
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const capture = new FixedChatGptCapture(state, settings, 'Chromium', new ArchiveCollectionSession(), {
    indexedDB,
    IDBKeyRange,
  })
  cleanup.push(() => capture.stop())
  capture.start()
  const source = (title: string, started: number, owner = 'synthetic-project-owner') =>
    state.ingestCatalog({
      items: [],
      projects: [{ projectId: 'g-p-synthetic', title }],
      observedAt: started + 1,
      requestStartedAt: started,
      accountId: owner,
    })
  source('Native project title', 2)
  expect(state.project('g-p-synthetic')?.title).toBe('Native project title')
  expect(await capture.listSavedProjects()).toEqual([])
  await settings.update({ archive: { defaultRule: { enabled: true } } })
  expect(await capture.listSavedProjects()).toEqual([
    { projectId: 'g-p-synthetic', title: 'Native project title' },
  ])
  source('Stale title', 1)
  source('Wrong owner title', 20, 'synthetic-other-owner')
  expect(state.project('g-p-synthetic')?.title).toBe('Native project title')
  await settings.update({
    archive: {
      projects: { 'g-p-synthetic': { enabled: false, reasoning: true, tools: true, internal: true } },
    },
  })
  source('New RAM title', 3)
  expect(state.project('g-p-synthetic')?.title).toBe('New RAM title')
  expect((await capture.listSavedProjects())[0]?.title).toBe('Native project title')
  await settings.update({ archive: { projects: { 'g-p-synthetic': null } } })
  expect((await capture.listSavedProjects())[0]?.title).toBe('New RAM title')
  await settings.update({ enabled: false })
  source('Master off RAM title', 4)
  expect((await capture.listSavedProjects())[0]?.title).toBe('New RAM title')
  await settings.update({ enabled: true })
  expect((await capture.listSavedProjects())[0]?.title).toBe('Master off RAM title')
  await settings.update({
    automation: {
      remote: { enabled: true, mode: 'remote-only', endpoint: 'wss://synthetic.example.test' },
    },
  })
  source('Remote only RAM title', 5)
  expect(state.project('g-p-synthetic')?.title).toBe('Remote only RAM title')
  expect((await capture.listSavedProjects())[0]?.title).toBe('Master off RAM title')
  state.ingestAccount({ accountId: null, observedAt: 30 })
  expect(state.listProjects()).toEqual([])
  await expect(capture.listSavedProjects()).rejects.toThrow('Unverified owner')
})

test('project title admission and authorization failures leave its existing durable row unchanged', async () => {
  const repo = new FixedCanonicalDexieRepository(
    {
      productId: 'chatgpt-booster',
      channel: 'dev',
      installationId: 'synthetic-project-title-budget',
      ownerId: 'synthetic-project-title-owner',
    },
    { indexedDB, IDBKeyRange },
  )
  cleanup.push(() => repo.close())
  await repo.upsertProjectTitle('g-p-synthetic', 'Initial source title', () => true)
  await expect(repo.upsertProjectTitle('g-p-synthetic', 'x'.repeat(4097), () => true)).rejects.toThrow()
  let checks = 0
  await expect(
    repo.upsertProjectTitle('g-p-synthetic', 'Must roll back', () => ++checks < 4),
  ).rejects.toThrow('Project metadata authorization expired')
  expect((await repo.listProjects())[0]?.title).toBe('Initial source title')
})

test('pending project persistence loses authorization when owner changes during settings read', async () => {
  installDom('project-owner-fence')
  const state = new ConversationStateStore(window)
  state.ingestAccount({ accountId: 'synthetic-before-switch', observedAt: 1 })
  let releaseRead: (settings: ReturnType<typeof normalizeSettings>) => void = () => undefined
  const pendingRead = new Promise<ReturnType<typeof normalizeSettings>>((resolve) => {
    releaseRead = resolve
  })
  const settings = {
    get: () => pendingRead,
    subscribe: () => () => undefined,
  } as unknown as SettingsAdapter
  const capture = new FixedChatGptCapture(state, settings, 'Chromium', new ArchiveCollectionSession(), {
    indexedDB,
    IDBKeyRange,
  })
  cleanup.push(() => capture.stop())
  capture.start()
  state.ingestCatalog({
    accountId: 'synthetic-before-switch',
    items: [],
    projects: [{ projectId: 'g-p-synthetic', title: 'Must not persist' }],
    requestStartedAt: 2,
    observedAt: 3,
  })
  await tick()
  state.ingestAccount({ accountId: 'synthetic-after-switch', observedAt: 4 })
  releaseRead(mergeSettings(normalizeSettings(), { archive: { defaultRule: { enabled: true } } }))
  expect(await capture.listSavedProjects()).toEqual([])
})
