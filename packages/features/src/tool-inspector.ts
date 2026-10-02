import { findToolCallEvidence } from '@chatgpt-booster/chatgpt'
import type { BoosterModule, SettingsAdapter } from '@chatgpt-booster/core'
import { type MountedToolInspector, mountToolInspector, resolveLocale } from '@chatgpt-booster/ui'

const ASSISTANT_TURN_SELECTOR = [
  '[data-message-author-role="assistant"]',
  '[data-turn="assistant"]',
  '[data-author="assistant"]',
].join(',')

const SCAN_DELAY_MS = 300

export class ToolInspectorModule implements BoosterModule {
  readonly id = 'tool-inspector'

  readonly #settings: SettingsAdapter
  readonly #mounted = new Map<HTMLElement, MountedToolInspector>()
  readonly #pendingRoots = new Set<ParentNode>()
  #observer: MutationObserver | undefined
  #unsubscribe: (() => void) | undefined
  #scanTimer: ReturnType<typeof setTimeout> | undefined
  #enabled = true
  #language: 'auto' | 'en' | 'ru' = 'auto'

  constructor(settings: SettingsAdapter) {
    this.#settings = settings
  }

  async start() {
    const settings = await this.#settings.get()
    this.#enabled = settings.enabled && settings.features.toolInspector
    this.#language = settings.language

    if (this.#enabled) this.#scanRoot(document)

    this.#observer = new MutationObserver((records) => this.#queueMutationRecords(records))
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
      this.#scanRoot(document)
    })
  }

  stop() {
    this.#observer?.disconnect()
    this.#observer = undefined
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    if (this.#scanTimer) clearTimeout(this.#scanTimer)
    this.#scanTimer = undefined
    this.#pendingRoots.clear()
    this.#clear()
  }

  #queueMutationRecords(records: MutationRecord[]) {
    if (!this.#enabled) return

    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      const turn = target?.closest(ASSISTANT_TURN_SELECTOR)
      if (turn) this.#pendingRoots.add(turn)

      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue

        const ownTurn = node.matches(ASSISTANT_TURN_SELECTOR)
          ? node
          : node.closest(ASSISTANT_TURN_SELECTOR)
        if (ownTurn) this.#pendingRoots.add(ownTurn)

        for (const nestedTurn of node.querySelectorAll(ASSISTANT_TURN_SELECTOR)) {
          this.#pendingRoots.add(nestedTurn)
        }
      }
    }

    if (this.#pendingRoots.size === 0 || this.#scanTimer) return
    this.#scanTimer = setTimeout(() => {
      this.#scanTimer = undefined
      const roots = [...this.#pendingRoots]
      this.#pendingRoots.clear()
      for (const root of roots) this.#scanRoot(root)
      this.#cleanupDisconnected()
    }, SCAN_DELAY_MS)
  }

  #scanRoot(root: ParentNode) {
    for (const evidence of findToolCallEvidence(root)) {
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
    this.#cleanupDisconnected()
  }

  #cleanupDisconnected() {
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
