import type {
  ChatGptAutomationControl,
  ChatGptAutomationStatus,
  SecretAdapter,
  SettingsAdapter,
} from '@chatgpt-booster/core'
import {
  createRemoteSession,
  probeRemoteSession,
  type RemoteCommandHandlers,
} from '@kobaproduction/browser-adapters'
import {
  type AutomationConfiguration,
  createAutomationTriggerDraft,
  DEFAULT_AUTOMATION_CONFIGURATION,
  REMOTE_COMMAND_KINDS,
  type RemoteCommandKind,
  type RemoteCommandPayloadMap,
  validateRemoteCommandPayload,
} from '@kobaproduction/browser-core'
import { createVolatileRemoteOutbox } from '@kobaproduction/browser-storage'

const ENDPOINT = 'ws://127.0.0.1:8787/ws'
/** Construct only behind explicit ?wsFixture=1. No real archive, token store or IndexedDB. */
export function createLabAutomation(settings: SettingsAdapter, productId = 'chatgpt-booster') {
  const scope = {
    productId,
    channel: 'dev' as const,
    installationId: 'ui-lab',
    ownerId: 'synthetic-owner',
  }
  const draft = createAutomationTriggerDraft(),
    listeners = new Set<() => void>()
  let configuration: AutomationConfiguration = structuredClone(DEFAULT_AUTOMATION_CONFIGURATION),
    token = '',
    closed = false,
    revision = 0
  let checked: { endpoint: string; token: string } | undefined
  let remote: ReturnType<typeof createRemoteSession> | undefined,
    unsubscribeRemote: (() => void) | undefined
  let work = Promise.resolve()
  const notify = () => {
    if (!closed)
      for (const listener of listeners)
        try {
          listener()
        } catch {}
  }
  const sync = () => {
    const current = revision
    const next = work.then(async () => {
      if (closed || current !== revision) return
      const config = configuration.remote
      if (
        !config.enabled ||
        config.mode === 'local-only' ||
        config.endpoint !== ENDPOINT ||
        token !== checked?.token ||
        checked?.endpoint !== ENDPOINT
      ) {
        await remote?.stop()
        notify()
        return
      }
      // Lab has no local archive or durable delivery store. Its explicit fixture
      // always uses the honest volatile route, regardless of the product preview.
      const runtime = { ...config, mode: 'remote-only' as const }
      if (!remote) {
        const handlers = Object.fromEntries(
          REMOTE_COMMAND_KINDS.map((kind) => [
            kind,
            (payload: RemoteCommandPayloadMap[typeof kind]) => dispatch(kind, payload),
          ]),
        ) as RemoteCommandHandlers
        remote = createRemoteSession({
          scope,
          sessionId: crypto.randomUUID(),
          getToken: async () => token,
          config: runtime,
          outbox: createVolatileRemoteOutbox(),
          handlers,
        })
        unsubscribeRemote = remote.subscribe(() => notify())
      }
      await remote.configure(runtime)
      await remote.start()
      notify()
    })
    work = next.catch(() => notify())
    return next
  }
  const refresh = (next: AutomationConfiguration) => {
    configuration = structuredClone(next)
    draft.acceptSaved(configuration.rules)
    revision++
    void sync()
  }
  const updateDraft = () => {
    notify()
    return { status: 'executed', persisted: false, triggers: draft.state() }
  }
  async function dispatch<K extends RemoteCommandKind>(
    kind: K,
    input: RemoteCommandPayloadMap[K],
  ): Promise<unknown> {
    if (closed) throw Error('Synthetic fixture is closed')
    const payload = validateRemoteCommandPayload(kind, input),
      state = draft.state()
    if (kind === 'triggers-list')
      return {
        saved: state.savedRules.map(({ id, label, enabled }) => ({ id, label, enabled })),
        draft: state.draftRules.map(({ id, label, enabled }) => ({ id, label, enabled })),
        unsaved: state.unsaved,
        revision: state.revision,
      }
    if (kind === 'triggers-get-config') return { configuration, triggers: state }
    if (kind === 'triggers-get-unsaved') return state
    if (kind === 'triggers-get') {
      const id = (payload as RemoteCommandPayloadMap['triggers-get']).id
      return {
        saved: state.savedRules.find((rule) => rule.id === id) ?? null,
        draft: state.draftRules.find((rule) => rule.id === id) ?? null,
        unsaved: state.unsaved,
      }
    }
    if (kind === 'triggers-draft-set') {
      draft.set((payload as RemoteCommandPayloadMap['triggers-draft-set']).rules)
      return updateDraft()
    }
    if (kind === 'triggers-draft-upsert') {
      draft.upsert((payload as RemoteCommandPayloadMap['triggers-draft-upsert']).rule)
      return updateDraft()
    }
    if (kind === 'triggers-draft-remove') {
      draft.remove((payload as RemoteCommandPayloadMap['triggers-draft-remove']).id)
      return updateDraft()
    }
    if (kind === 'triggers-draft-reset') {
      draft.reset()
      return updateDraft()
    }
    if (kind === 'triggers-draft-discard') {
      draft.discard()
      return updateDraft()
    }
    if (kind === 'triggers-draft-save' || kind === 'triggers-set' || kind === 'triggers-reset') {
      const rules =
        kind === 'triggers-draft-save'
          ? state.draftRules
          : kind === 'triggers-set'
            ? (payload as RemoteCommandPayloadMap['triggers-set']).rules
            : []
      const saved = await settings.update({ automation: { rules } })
      refresh(saved.automation)
      if (kind !== 'triggers-draft-save') draft.acceptSaved(saved.automation.rules, true)
      notify()
      return { status: 'executed', persisted: true, triggers: draft.state() }
    }
    throw Error('Native actions and real archives are unavailable in the synthetic fixture')
  }
  const control: ChatGptAutomationControl = {
    status: (): ChatGptAutomationStatus => ({
      enabled: configuration.enabled,
      domEvents: configuration.domEvents,
      verifiedOwner: true,
      remote: remote?.status() ?? null,
      sync: { state: 'idle', queuedRows: 0, totalRows: 0 },
      triggers: draft.state(),
    }),
    triggerState: () => draft.state(),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispatch,
    async probe(candidate) {
      let endpoint: string
      try {
        endpoint = new URL(candidate.endpoint).href
      } catch {
        return {
          ok: false,
          endpoint: candidate.endpoint,
          checkedAt: Date.now(),
          errorCode: 'invalid-configuration',
        }
      }
      if (endpoint !== ENDPOINT)
        return { ok: false, endpoint, checkedAt: Date.now(), errorCode: 'invalid-configuration' }
      const result = await probeRemoteSession({ ...candidate, endpoint, scope })
      if (result.ok) checked = { endpoint, token: candidate.token }
      return result
    },
    async reconnect() {
      await work
      if (remote) await remote.reconnect()
      else await sync()
    },
    async retryPending() {
      await remote?.retryDeadLetters()
    },
    async syncArchive() {
      throw Error('Only synthetic connection/trigger testing is available')
    },
    cancelSync() {},
  }
  const secrets: SecretAdapter = {
    getTelemetryToken: async () => '',
    setTelemetryToken: async () => {
      throw Error('Telemetry credentials are unavailable in Lab')
    },
    getRemoteToken: async () => token,
    async setRemoteToken(value) {
      if (value && value !== checked?.token)
        throw Error('Verify the synthetic endpoint and token before saving')
      token = value
      revision++
      await sync()
      notify()
    },
  }
  const unsubscribe = settings.subscribe((value) => refresh(value.automation))
  const initial = revision
  void settings.get().then((value) => {
    if (!closed && initial === revision) refresh(value.automation)
  })
  return {
    control,
    secrets,
    async close() {
      closed = true
      revision++
      unsubscribe()
      unsubscribeRemote?.()
      await remote?.stop()
      listeners.clear()
      token = ''
      checked = undefined
    },
  }
}
