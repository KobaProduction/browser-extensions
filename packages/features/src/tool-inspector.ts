import { findToolCallEvidence } from '@chatgpt-booster/chatgpt'
import type { BoosterModule, SettingsAdapter } from '@chatgpt-booster/core'
import { type MountedToolInspector, mountToolInspector, resolveLocale } from '@chatgpt-booster/ui'

export class ToolInspectorModule implements BoosterModule {
  readonly id = 'tool-inspector'

  readonly #settings: SettingsAdapter
  readonly #mounted = new Map<HTMLElement, MountedToolInspector>()
  #observer: MutationObserver | undefined
  #unsubscribe: (() => void) | undefined
  #scanQueued = false
  #enabled = true
  #language: 'auto' | 'en' | 'ru' = 'auto'

  constructor(settings: SettingsAdapter) {
    this.#settings = settings
  }

  async start() {
    const settings = await this.#settings.get()
    this.#enabled = settings.enabled && settings.features.toolInspector
    this.#language = settings.language

    if (this.#enabled) this.#scan()

    this.#observer = new MutationObserver(() => this.#queueScan())
    this.#observer.observe(document.body, { childList: true, subtree: true })

    this.#unsubscribe = this.#settings.subscribe((next) => {
      const enabled = next.enabled && next.features.toolInspector
      const languageChanged = next.language !== this.#language

      this.#enabled = enabled
      this.#language = next.language

      if (!enabled) {
        this.#clear()
        return
      }

      if (languageChanged) this.#clear()
      this.#scan()
    })
  }

  stop() {
    this.#observer?.disconnect()
    this.#observer = undefined
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    this.#clear()
  }

  #queueScan() {
    if (!this.#enabled || this.#scanQueued) return
    this.#scanQueued = true

    window.requestAnimationFrame(() => {
      this.#scanQueued = false
      this.#scan()
    })
  }

  #scan() {
    for (const evidence of findToolCallEvidence()) {
      if (this.#mounted.has(evidence.element)) continue

      const mounted = mountToolInspector(evidence.element, {
        id: evidence.id,
        label: evidence.label,
        kind: evidence.kind,
        locale: resolveLocale(this.#language),
        ...(evidence.timestamp ? { timestamp: evidence.timestamp } : {}),
        structuredPayloads: evidence.structuredPayloads,
        attributes: evidence.attributes,
        visibleText: evidence.visibleText,
        score: evidence.score,
        signals: evidence.signals,
      })

      this.#mounted.set(evidence.element, mounted)
    }

    for (const [target, mounted] of this.#mounted) {
      if (!target.isConnected) {
        mounted.unmount()
        this.#mounted.delete(target)
      }
    }
  }

  #clear() {
    for (const mounted of this.#mounted.values()) mounted.unmount()
    this.#mounted.clear()
  }
}
