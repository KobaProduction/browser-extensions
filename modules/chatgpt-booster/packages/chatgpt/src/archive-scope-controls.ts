import type { ArchiveCaptureContext } from '@chatgpt-booster/core'
import { currentConversationId, currentProjectId, currentProjectTitle } from './conversation-scroll'
import { type ScheduledIdleTask, scheduleIdleTask } from './idle-task'

export interface MountedArchiveScopeSlot {
  update(context: ArchiveCaptureContext): void
  unmount(): void
}

interface ScopeControlOptions {
  visible(context: ArchiveCaptureContext): boolean
  mount(host: HTMLElement, context: ArchiveCaptureContext): MountedArchiveScopeSlot
}

/**
 * Owns only ChatGPT-specific target discovery and slot placement.
 * Rendering and behavior live in the feature/UI layers.
 */
export function mountArchiveScopeControls(initial: ScopeControlOptions) {
  let options = initial
  const owned = new Map<
    HTMLAnchorElement,
    {
      host: HTMLElement
      mounted: MountedArchiveScopeSlot
      context: ArchiveCaptureContext
      parent: HTMLElement
      position: string
      changedPosition: boolean
    }
  >()
  let stopped = false
  let queued: ScheduledIdleTask | undefined

  function sameContext(a: ArchiveCaptureContext, b: ArchiveCaptureContext) {
    return (
      a.scope === b.scope &&
      a.id === b.id &&
      a.title === b.title &&
      (a.scope !== 'conversation' ||
        b.scope !== 'conversation' ||
        (a.projectId ?? null) === (b.projectId ?? null))
    )
  }

  function scopeMutationNode(node: Node): boolean {
    const element = node instanceof Element ? node : node.parentElement
    if (!element || element.closest('[data-chatgpt-booster], #chatgpt-booster-root')) return false
    if (
      element.matches(
        'nav, header, main [role="list"], [role="row"][data-page-table-selectable-row="true"]',
      ) ||
      element.closest(
        'nav, header, main [role="list"], [role="row"][data-page-table-selectable-row="true"]',
      )
    )
      return true
    return Boolean(
      element.querySelector(
        'nav a[href], header a[href], main [role="list"] a[href], main [role="row"][data-page-table-selectable-row="true"]',
      ),
    )
  }

  function scopeMutationRelevant(record: MutationRecord): boolean {
    if (record.type === 'attributes') return scopeMutationNode(record.target)
    if (scopeMutationNode(record.target)) return true
    return [...record.addedNodes, ...record.removedNodes].some(scopeMutationNode)
  }

  function contextFor(link: HTMLAnchorElement): ArchiveCaptureContext | undefined {
    const id = currentConversationId(link.href)
    if (id)
      return {
        scope: 'conversation',
        id,
        title: link.textContent?.trim().split('\n')[0] || null,
        projectId:
          currentProjectId(link.href) ??
          (id === currentConversationId() ? (currentProjectId() ?? null) : null),
      }
    const projectId = currentProjectId(link.href)
    if (!projectId || !link.pathname.endsWith('/project')) return undefined
    return {
      scope: 'project',
      id: projectId,
      title: currentProjectTitle(projectId) ?? (link.textContent?.trim() || null),
    }
  }

  function remove(link: HTMLAnchorElement) {
    const item = owned.get(link)
    if (!item) return
    item.mounted.unmount()
    item.host.remove()
    if (item.changedPosition && item.parent.style.position === 'relative')
      item.parent.style.position = item.position
    owned.delete(link)
  }

  function refresh() {
    if (stopped) return
    observer.disconnect()

    for (const [link, item] of owned) {
      const context = link.isConnected ? contextFor(link) : undefined
      if (
        !context ||
        !options.visible(context) ||
        !item.host.isConnected ||
        item.host.parentElement !== item.parent
      ) {
        remove(link)
        continue
      }
      if (!sameContext(item.context, context)) {
        item.context = context
        item.mounted.update(context)
      }
    }

    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'nav a[href], header a[href], main [role="list"] a[href]',
    )) {
      if (owned.has(link) || link.closest('[data-chatgpt-booster], #chatgpt-booster-root')) continue
      const context = contextFor(link)
      const parent = link.parentElement
      if (!context || !parent || !options.visible(context)) continue

      const host = document.createElement('span')
      host.dataset.chatgptBooster = 'archive-scope-control'
      const conversationMarker = context.scope === 'conversation'
      const insertionParent = conversationMarker ? link : parent
      const isRow = !conversationMarker && parent.tagName === 'LI'
      const position = parent.style.position
      const changedPosition = isRow && getComputedStyle(parent).position === 'static'
      if (changedPosition) parent.style.position = 'relative'

      host.style.cssText = conversationMarker
        ? 'display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:10px;height:18px;margin-inline-end:5px;pointer-events:none;'
        : isRow
          ? 'position:absolute;right:62px;top:50%;transform:translateY(-50%);z-index:4;width:28px;height:28px;'
          : 'display:inline-flex;vertical-align:middle;margin-inline:4px;width:28px;height:28px;'

      if (!conversationMarker) {
        host.addEventListener('pointerdown', (event) => {
          event.preventDefault()
          event.stopPropagation()
        })
        host.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
        })
      }

      const mounted = options.mount(host, context)
      if (conversationMarker) link.prepend(host)
      else parent.append(host)
      owned.set(link, {
        host,
        mounted,
        context,
        parent: insertionParent,
        position,
        changedPosition,
      })
    }

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    })
  }

  const observer = new MutationObserver((records) => {
    if (queued || stopped || !records.some(scopeMutationRelevant)) return
    queued = scheduleIdleTask(
      () => {
        queued = undefined
        refresh()
      },
      450,
      180,
    )
  })

  queued = scheduleIdleTask(() => {
    queued = undefined
    refresh()
  }, 450)

  return {
    update(next: ScopeControlOptions) {
      options = next
      refresh()
    },
    refresh,
    stop() {
      stopped = true
      observer.disconnect()
      queued?.cancel()
      queued = undefined
      for (const [link] of owned) remove(link)
    },
  }
}
