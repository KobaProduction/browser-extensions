import { afterEach, expect, test } from 'bun:test'
import { normalizeSettings, type SettingsAdapter } from '@chatgpt-booster/core'
import { bindNativeAccountSource, installTransportObserver } from '@chatgpt-booster/observer'
import { Window } from 'happy-dom'
import {
  CHATGPT_NATIVE_ACCOUNT_CONTRACT,
  type ChatGptNativeAccountBindingOptions,
  createChatGptNativeAccountSource,
} from './native-account-binding'
import { createBoosterPageRuntime } from './page-runtime'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
function nativeFixture() {
  const account = Symbol('account'),
    user = Symbol('user')
  const identity = { account: 'owner-A', user: 'user-A' }
  let reads = 0
  const registry = {
    default_account_id: 'owner-A',
    account_ordering: ['owner-A'],
    accounts: [{ id: 'owner-A', can_access_with_session: true }],
  }
  const options: ChatGptNativeAccountBindingOptions = {
    contractVersion: CHATGPT_NATIVE_ACCOUNT_CONTRACT,
    scope: {
      get: (token) =>
        token === account ? identity.account : token === user ? identity.user : undefined,
    },
    modules: {
      g2: { n: account },
      Cs: { i: user },
      Iet: {
        async c(scope, signal, force) {
          expect(scope).toBe(options.scope)
          expect(signal.aborted).toBe(false)
          expect(force).toBe(true)
          reads++
          return registry
        },
      },
    },
  }
  return { options, identity, registry, reads: () => reads }
}
async function setup() {
  const dom = new Window({ url: 'https://chatgpt.com/c/synthetic-chat' })
  Object.assign(dom, { EventSource: class extends EventTarget {} })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    CustomEvent: globalThis.CustomEvent,
  }
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    location: dom.location,
    CustomEvent: dom.CustomEvent,
  })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  dom.postMessage = (value) => {
    dom.dispatchEvent(
      new dom.MessageEvent('message', {
        source: dom as never,
        origin: dom.location.origin,
        data: value,
      }),
    )
  }
  let catalogOk = true
  dom.fetch = async () =>
    new Response(JSON.stringify({ items: [] }), {
      status: catalogOk ? 200 : 403,
      headers: { 'content-type': 'application/json' },
    }) as never
  const detach = installTransportObserver(dom as unknown as globalThis.Window & typeof globalThis)
  cleanup.push(detach)
  let saved = normalizeSettings({ enabled: true })
  const settings: SettingsAdapter = {
    get: async () => saved,
    set: async (value) => {
      saved = value
      return value
    },
    update: async () => saved,
    subscribe: () => () => undefined,
  }
  const page = createBoosterPageRuntime({
    mountUi: false,
    externalSounds: true,
    target: {
      label: 'Tampermonkey',
      settings,
      diagnostics: { recordTransportBatch() {} } as never,
      pageBridgeWindow: dom as unknown as globalThis.Window,
    },
  })
  cleanup.push(async () => {
    await page.automation.stop()
    await page.fixedArchive.stop()
    await page.runtime.stop()
  })
  await page.startEarly()
  const catalog = async (owner = 'owner-A') => {
    await dom.fetch('https://chatgpt.com/backend-api/conversations?limit=1', {
      headers: { 'ChatGPT-Account-ID': owner },
    })
    await tick()
  }
  return {
    dom,
    page,
    catalog,
    detach,
    setCatalogOk: (value: boolean) => {
      catalogOk = value
    },
  }
}

test('native registry refresh drives actual runtime owner proof only after independent successful network catalog selection', async () => {
  const f = nativeFixture(),
    { page, catalog, setCatalogOk } = await setup()
  const binding = page.bindNativeAccounts(f.options)
  cleanup.push(binding.dispose)
  await binding.refresh()
  expect(f.reads()).toBe(1)
  expect(page.automation.status().verifiedOwner).toBe(false)
  setCatalogOk(false)
  await catalog()
  expect(page.automation.status().verifiedOwner).toBe(false)
  setCatalogOk(true)
  await catalog()
  expect(page.automation.status().verifiedOwner).toBe(true)
  await catalog('owner-B')
  expect(page.automation.status().verifiedOwner).toBe(false)
})

test('native source rejects stale identity, mismatched default and inaccessible membership without owner evidence', async () => {
  const f = nativeFixture(),
    source = createChatGptNativeAccountSource(f.options)
  f.options.modules.Iet.c = async () => {
    await Promise.resolve()
    f.identity.user = 'user-B'
    return f.registry
  }
  await expect(source.read(new AbortController().signal)).rejects.toThrow('automation.ownerChanged')
  f.identity.user = 'user-A'
  f.options.modules.Iet.c = async () => f.registry
  f.registry.default_account_id = 'owner-B'
  await expect(source.read(new AbortController().signal)).rejects.toThrow(
    'automation.nativeMethodUnavailable',
  )
  f.registry.default_account_id = 'owner-A'
  f.registry.accounts = [{ id: 'owner-A', can_access_with_session: false }]
  await expect(source.read(new AbortController().signal)).rejects.toThrow(
    'automation.nativeMethodUnavailable',
  )
})

test('replaced, disposed and detached native callbacks cannot verify an owner after their native await', async () => {
  const { dom, page, catalog, detach } = await setup()
  await catalog()
  const pending: (() => void)[] = []
  const delayed = () =>
    bindNativeAccountSource(dom, {
      read: async () => {
        await new Promise<void>((resolve) => pending.push(resolve))
        return { selectedAccountId: 'owner-A', accountIds: ['owner-A'] }
      },
    })
  const first = delayed(),
    a = first.refresh()
  await tick()
  const second = delayed()
  await expect(a).rejects.toThrow('automation.commandCancelled')
  const b = second.refresh()
  await tick()
  first.dispose()
  second.dispose()
  await expect(b).rejects.toThrow('automation.commandCancelled')
  for (const resolve of pending.splice(0)) resolve()
  await tick()
  expect(page.automation.status().verifiedOwner).toBe(false)
  const third = delayed(),
    c = third.refresh()
  await tick()
  detach()
  await expect(c).rejects.toThrow('automation.commandCancelled')
  pending.shift()?.()
  await tick()
  expect(page.automation.status().verifiedOwner).toBe(false)
  expect(() => delayed()).toThrow('automation.nativeMethodUnavailable')
})

test('native registry response spanning A to B to A catalog selections is discarded', async () => {
  const { dom, page, catalog } = await setup()
  await catalog()
  let resolve!: () => void
  const binding = bindNativeAccountSource(dom, {
    read: async () => {
      await new Promise<void>((done) => {
        resolve = done
      })
      return { selectedAccountId: 'owner-A', accountIds: ['owner-A'] }
    },
  })
  cleanup.push(binding.dispose)
  const pending = binding.refresh()
  await catalog('owner-B')
  await catalog('owner-A')
  resolve()
  await pending
  expect(page.automation.status().verifiedOwner).toBe(false)
  const current = bindNativeAccountSource(dom, {
    read: async () => ({ selectedAccountId: 'owner-A', accountIds: ['owner-A'] }),
  })
  cleanup.push(current.dispose)
  await current.refresh()
  expect(page.automation.status().verifiedOwner).toBe(true)
})
