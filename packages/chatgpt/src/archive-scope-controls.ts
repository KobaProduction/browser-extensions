import type { ArchiveCaptureContext } from '@chatgpt-booster/core'
import { currentConversationId, currentProjectId, currentProjectTitle } from './conversation-scroll'

export interface MountedArchiveScopeSlot {
  update(context: ArchiveCaptureContext): void
  unmount(): void
}

interface ScopeControlOptions {
  visible(context: ArchiveCaptureContext): boolean
  mount(host: HTMLElement, context: ArchiveCaptureContext): MountedArchiveScopeSlot
  resolveProjectContext?(title: string): ArchiveCaptureContext | undefined
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
  const projectRows = new Map<
    HTMLElement,
    {
      host: HTMLElement
      mounted: MountedArchiveScopeSlot
      context: ArchiveCaptureContext
      parent: HTMLElement
    }
  >()
  let stopped = false
  let queued: ReturnType<typeof setTimeout> | undefined

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
      element.matches('nav, header, [role="row"][data-page-table-selectable-row="true"]') ||
      element.closest('nav, header, [role="row"][data-page-table-selectable-row="true"]')
    )
      return true
    return Boolean(
      element.querySelector(
        'nav a[href], header a[href], main [role="row"][data-page-table-selectable-row="true"]',
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

  function removeProjectRow(row: HTMLElement) {
    const item = projectRows.get(row)
    if (!item) return
    item.mounted.unmount()
    item.host.remove()
    projectRows.delete(row)
  }

  function projectRowTitle(row: HTMLElement): string | null {
    const actions = row.querySelector<HTMLButtonElement>(
      'button[aria-label][data-page-table-row-actions-focus-target="true"]',
    )
    const quoted = actions
      ?.getAttribute('aria-label')
      ?.match(/[«“"]([^»”"]+)[»”"]/)?.[1]
      ?.trim()
    if (quoted) return quoted

    const folder = row.querySelector<HTMLElement>('[data-testid="project-folder-icon"]')
    if (!folder) return null
    const cell = folder.closest<HTMLElement>('[role="gridcell"]')
    if (!cell) return null
    const values = [...cell.querySelectorAll<HTMLElement>('div, span')]
      .filter((element) => !element.querySelector('div, span'))
      .map((element) => element.textContent?.trim() ?? '')
      .filter(
        (value) =>
          value &&
          !/^(?:today|yesterday|сегодня|вчера|\d+[\s\S]*(?:ago|назад|мин|ч|дн))$/i.test(value),
      )
    return values[0] ?? null
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

    for (const [row, item] of projectRows) {
      const title = row.isConnected ? projectRowTitle(row) : null
      const context = title ? options.resolveProjectContext?.(title) : undefined
      if (
        !context ||
        !options.visible(context) ||
        !item.host.isConnected ||
        item.host.parentElement !== item.parent
      ) {
        removeProjectRow(row)
        continue
      }
      if (!sameContext(item.context, context)) {
        item.context = context
        item.mounted.update(context)
      }
    }

    for (const row of document.querySelectorAll<HTMLElement>(
      'main [role="row"][data-page-table-selectable-row="true"]',
    )) {
      if (projectRows.has(row) || row.closest('[data-chatgpt-booster], #chatgpt-booster-root'))
        continue
      const title = projectRowTitle(row)
      const context = title ? options.resolveProjectContext?.(title) : undefined
      if (!context || !options.visible(context)) continue
      const folder = row.querySelector<HTMLElement>('[data-testid="project-folder-icon"]')
      const folderFrame = folder?.parentElement
      const cell = folder?.closest<HTMLElement>('[role="gridcell"]')
      if (!folder || !folderFrame || !cell) continue

      const host = document.createElement('span')
      host.dataset.chatgptBooster = 'archive-scope-control'
      host.style.cssText =
        'display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;width:28px;height:28px;'
      host.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })
      host.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
      })

      const mounted = options.mount(host, context)
      folderFrame.insertAdjacentElement('afterend', host)
      projectRows.set(row, { host, mounted, context, parent: cell })
    }

    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'nav a[href], header a[href]',
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
    queued = setTimeout(() => {
      queued = undefined
      refresh()
    }, 200)
  })

  refresh()

  return {
    update(next: ScopeControlOptions) {
      options = next
      refresh()
    },
    refresh,
    stop() {
      stopped = true
      observer.disconnect()
      if (queued) clearTimeout(queued)
      queued = undefined
      for (const [link] of owned) remove(link)
      for (const [row] of projectRows) removeProjectRow(row)
    },
  }
}
