import {
  BOOSTER_VERSION,
  type BoosterRuntime,
  createDiagnosticsStore,
  isChatGptPage,
} from '@chatgpt-booster/core'
import { createBoosterPageRuntime } from '@chatgpt-booster/features'
import { chromeAnalytics } from '../analytics'
import { chromeSettings } from '../settings'
import { chromeSecrets, createChromeTelemetry, createChromeTelemetryControl } from '../telemetry'

const diagnostics = createDiagnosticsStore()
const telemetry = createChromeTelemetry(chromeSettings)
const pageRuntime = createBoosterPageRuntime({
  target: {
    kind: 'extension',
    settings: chromeSettings,
    diagnostics,
    persistentDiagnostics: chromeAnalytics,
    secrets: chromeSecrets,
    telemetry,
    telemetryControl: createChromeTelemetryControl(telemetry),
  },
})

const CONTENT_RUNTIME_MARKER = '__chatgptBoosterContentRuntime__'
const CONTENT_RUNTIME_DATASET = 'chatgptBoosterRuntimeVersion'
const CONTENT_RUNTIME_INSTANCE_DATASET = 'chatgptBoosterRuntimeInstance'
const CONTENT_RUNTIME_CLAIM_EVENT = 'chatgpt-booster:content-runtime-claim'

interface ContentRuntimeHandle {
  version: string
  instanceId: string
  runtime?: BoosterRuntime
  onClaim?: (event: Event) => void
}

const runtimeWindow = window as unknown as Window & Record<string, unknown>

function cleanupStaleBoosterDom() {
  for (const element of document.querySelectorAll('#chatgpt-booster-root, [data-chatgpt-booster]'))
    element.remove()
}

async function stopRuntimeHandle(handle: ContentRuntimeHandle) {
  if (handle.onClaim) window.removeEventListener(CONTENT_RUNTIME_CLAIM_EVENT, handle.onClaim)
  if (!handle.runtime) return
  try {
    await handle.runtime.stop()
  } catch {
    // An extension update can invalidate APIs while the old isolated context is winding down.
  }
}

function runtimeInstanceId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function startRuntime(handle: ContentRuntimeHandle) {
  handle.runtime = pageRuntime.runtime
  await pageRuntime.runtime.start()
}

async function bootstrapContentRuntime() {
  if (!isChatGptPage()) return

  const domVersion = document.documentElement.dataset[CONTENT_RUNTIME_DATASET]
  const existingRoot = document.querySelector('#chatgpt-booster-root')
  if (domVersion === BOOSTER_VERSION && existingRoot) return

  const existing = runtimeWindow[CONTENT_RUNTIME_MARKER] as ContentRuntimeHandle | undefined
  if (existing?.version === BOOSTER_VERSION && existingRoot) {
    document.documentElement.dataset[CONTENT_RUNTIME_DATASET] = BOOSTER_VERSION
    document.documentElement.dataset[CONTENT_RUNTIME_INSTANCE_DATASET] = existing.instanceId
    return
  }

  if (existing) await stopRuntimeHandle(existing)

  const instanceId = runtimeInstanceId()
  document.documentElement.dataset[CONTENT_RUNTIME_DATASET] = BOOSTER_VERSION
  document.documentElement.dataset[CONTENT_RUNTIME_INSTANCE_DATASET] = instanceId
  window.dispatchEvent(
    new CustomEvent(CONTENT_RUNTIME_CLAIM_EVENT, {
      detail: { version: BOOSTER_VERSION, instanceId },
    }),
  )

  // Give an older isolated-world runtime one turn to disconnect MutationObservers and UI mounts.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  cleanupStaleBoosterDom()

  const handle: ContentRuntimeHandle = { version: BOOSTER_VERSION, instanceId }
  handle.onClaim = (event: Event) => {
    const detail = (event as CustomEvent<{ instanceId?: string }>).detail
    if (!detail?.instanceId || detail.instanceId === instanceId) return
    void stopRuntimeHandle(handle)
  }
  window.addEventListener(CONTENT_RUNTIME_CLAIM_EVENT, handle.onClaim)
  runtimeWindow[CONTENT_RUNTIME_MARKER] = handle

  // Publish archive policy as early as possible, before the UI waits for document.body.
  await pageRuntime.startEarly()

  const launch = () => {
    if (document.documentElement.dataset[CONTENT_RUNTIME_INSTANCE_DATASET] !== instanceId) return
    void startRuntime(handle)
  }
  if (document.body) launch()
  else window.addEventListener('DOMContentLoaded', launch, { once: true })
}

void bootstrapContentRuntime()
