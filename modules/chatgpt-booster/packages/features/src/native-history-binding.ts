import type { BoosterModule } from '@chatgpt-booster/core'
import type { ConversationStateStore } from './conversation-state'
import type { ChatGptNativeHistoryPort } from './history-loader'
import { bindNativeDeliveryFailure, type NativeDeliveryScope } from './native-delivery-binding'
import { loadNativeHistoryCapabilities } from './native-history-capabilities'
import {
  createNativeHistoryReader,
  type NativeHistoryScope,
  type NativeModules,
  nativePaginationPending,
} from './native-history-reader'
import { probeNativeScope } from './native-scope-probe'

export const NATIVE_HISTORY_BINDING = 'chatgpt-native-history-2026-10-23-v1'

/** Exact cached client contract. Captures a real AppScope hook result, never fabricates one. */
export class NativeHistoryBinding implements BoosterModule, ChatGptNativeHistoryPort {
  readonly id = 'native-history-binding'
  private active = false
  private probeAllowed = true
  private generation = 0
  private modules?: NativeModules
  private scope?: NativeHistoryScope
  private timer?: ReturnType<typeof setTimeout>
  private disposeProbe?: () => void
  private disposeDelivery?: () => void
  constructor(
    private state: ConversationStateStore,
    private loadCapabilities = loadNativeHistoryCapabilities,
    private waitMs = 10_000,
  ) {}
  start() {
    if (this.active) return
    this.active = true
    this.probeAllowed = true
    const generation = ++this.generation
    const until = Date.now() + 60_000
    const prepare = async () => {
      if (!this.active || generation !== this.generation) return
      try {
        const modules = await this.loadCapabilities()
        if (!this.active || generation !== this.generation) return
        this.modules = modules
        this.installProbe(generation)
      } catch {
        if (this.active && generation === this.generation && Date.now() < until)
          this.timer = setTimeout(() => {
            void prepare()
          }, 250)
      }
    }
    void prepare()
  }
  private installProbe(generation: number) {
    const modules = this.modules
    if (!modules || !this.probeAllowed || this.scope || this.disposeProbe) return
    this.disposeProbe = probeNativeScope(
      modules.react,
      modules.appToken,
      (candidate) => {
        this.disposeProbe = undefined
        if (!this.active || generation !== this.generation) return
        this.scope = candidate
        this.disposeDelivery?.()
        this.disposeDelivery = undefined
        if (
          modules.delivery &&
          Object.values(modules.delivery).every(Boolean) &&
          typeof (candidate as unknown as NativeDeliveryScope).watch === 'function'
        ) {
          try {
            this.disposeDelivery = bindNativeDeliveryFailure(
              this.state,
              candidate as unknown as NativeDeliveryScope,
              { account: modules.accountToken, ...modules.delivery },
              () => this.active && generation === this.generation,
            )
          } catch {
            /* Unsupported client bindings cannot affect native hooks. */
          }
        }
      },
      60_000,
      () => {
        this.disposeProbe = undefined
      },
    )
  }
  stop() {
    this.active = false
    this.generation++
    clearTimeout(this.timer)
    this.disposeProbe?.()
    this.disposeDelivery?.()
    this.disposeDelivery = undefined
    this.disposeProbe = undefined
    this.scope = undefined
    this.modules = undefined
  }
  hasPendingPages(conversationId: string): boolean | null {
    const owner = this.state.verifiedAccountId()
    if (!this.active || !this.scope || !this.modules || !owner) return null
    if (this.scope.get(this.modules.accountToken) !== owner) return null
    return nativePaginationPending(this.scope, this.modules.pagination, conversationId)
  }
  async readOlder(context: Parameters<ChatGptNativeHistoryPort['readOlder']>[0]) {
    const owner = this.state.verifiedAccountId(),
      epoch = this.state.accountEpoch(),
      generation = this.generation
    const assertCurrent = () => {
      context.signal.throwIfAborted()
      if (
        !this.active ||
        generation !== this.generation ||
        !owner ||
        owner !== this.state.verifiedAccountId() ||
        epoch !== this.state.accountEpoch()
      )
        throw Error('archive.error.sourceChanged')
    }
    const releasePendingProbe = () => {
      if (generation !== this.generation || this.scope) return
      this.probeAllowed = false
      this.disposeProbe?.()
      this.disposeProbe = undefined
    }
    this.probeAllowed = true
    context.signal.addEventListener('abort', releasePendingProbe, { once: true })
    try {
      assertCurrent()
      const until = Date.now() + this.waitMs
      // Wait for the probe to be installed before asking native hooks to rerun.
      // Revalidating first could miss the only AppScope invocation during startup.
      while (!this.modules && Date.now() < until) {
        assertCurrent()
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      }
      if (!this.scope && this.modules) {
        this.installProbe(generation)
        const router = (
          window as unknown as { __reactRouterDataRouter?: { revalidate(): Promise<void> | void } }
        ).__reactRouterDataRouter
        // A genuine native router refresh reruns native hooks without changing routes,
        // synthesizing a private request or using a DOM-click fallback.
        if (typeof router?.revalidate === 'function')
          void Promise.resolve(router.revalidate()).catch(() => undefined)
      }
      while (!this.scope && Date.now() < until) {
        assertCurrent()
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      }
      assertCurrent()
      const scope = this.scope,
        modules = this.modules
      if (!scope || !modules) throw Error('archive.error.nativeHistoryUnavailable')
      await createNativeHistoryReader(this.state, scope, modules, () => {
        assertCurrent()
        return true
      }).readOlder(context)
    } finally {
      context.signal.removeEventListener('abort', releasePendingProbe)
      releasePendingProbe()
    }
  }
}
