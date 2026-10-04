import type { ArchiveCaptureContext } from '@chatgpt-booster/core'
import { currentConversationId, currentProjectId, currentProjectTitle } from './conversation-scroll'

interface ScopeControlOptions {
  label(context: ArchiveCaptureContext): string
  enabled(context: ArchiveCaptureContext): boolean
  visible(context: ArchiveCaptureContext): boolean
  onOpen(context: ArchiveCaptureContext): void
}
/** Native link routing/DOM ownership stays inside the ChatGPT adapter. */
export function mountArchiveScopeControls(initial: ScopeControlOptions) {
  let options = initial
  const owned = new Map<
    HTMLAnchorElement,
    {
      host: HTMLElement
      button: HTMLButtonElement
      context: ArchiveCaptureContext
      parent: HTMLElement
      position: string
      changedPosition: boolean
    }
  >()
  let stopped = false
  let queued: ReturnType<typeof setTimeout> | undefined
  function contextFor(link: HTMLAnchorElement): ArchiveCaptureContext | undefined {
    const id = currentConversationId(link.href)
    if (id)
      return {
        scope: 'conversation',
        id,
        title: link.innerText.trim().split('\n')[0] || null,
        projectId:
          currentProjectId(link.href) ??
          (id === currentConversationId() ? (currentProjectId() ?? null) : null),
      }
    const projectId = currentProjectId(link.href)
    if (!projectId || !link.pathname.endsWith('/project')) return undefined
    return {
      scope: 'project',
      id: projectId,
      title: currentProjectTitle(projectId) ?? (link.innerText.trim() || null),
    }
  }
  function renderButton(button: HTMLButtonElement, context: ArchiveCaptureContext) {
    const enabled = options.enabled(context)
    const label = options.label(context)
    button.title = label
    button.setAttribute('aria-label', label)
    button.dataset.enabled = enabled ? 'true' : 'false'
    button.innerHTML = enabled
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 20 7v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8 12 3 3 5-6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 20 7v5c0 5-8 9-8 9s-8-4-8-9V7z"/><path d="m8.5 8.5 7 7"/><path d="m15.5 8.5-7 7"/></svg>'
  }

  function remove(link: HTMLAnchorElement) {
    const item = owned.get(link)
    if (!item) return
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
        item.parent !== link.parentElement
      ) {
        remove(link)
        continue
      }
      item.context = context
      renderButton(item.button, context)
    }
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      'nav a[href], header a[href]',
    )) {
      if (owned.has(link) || link.closest('[data-chatgpt-booster], #chatgpt-booster-root')) continue
      const context = contextFor(link),
        parent = link.parentElement
      if (!context || !parent || !options.visible(context)) continue
      const host = document.createElement('span')
      host.dataset.chatgptBooster = 'capture-control'
      const isRow = parent.tagName === 'LI'
      const position = parent.style.position
      const changedPosition = isRow && getComputedStyle(parent).position === 'static'
      if (changedPosition) parent.style.position = 'relative'
      host.style.cssText = isRow
        ? 'position:absolute;right:62px;top:50%;transform:translateY(-50%);z-index:3;width:24px;height:24px;'
        : 'display:inline-flex;vertical-align:middle;margin-inline:4px;width:24px;height:24px;'
      const shadow = host.attachShadow({ mode: 'open' })
      const style = document.createElement('style')
      style.textContent =
        ':host{color-scheme:light dark}button{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;background:light-dark(#f4f4f5,#27272a);color:light-dark(#27272a,#fafafa);cursor:pointer;opacity:.55}button[data-enabled="true"]{color:light-dark(#166534,#86efac);opacity:.9}button:hover,button:focus-visible{opacity:1;outline:1px solid currentColor}svg{width:14px;height:14px;pointer-events:none}'
      const button = document.createElement('button')
      button.type = 'button'
      renderButton(button, context)
      shadow.append(style, button)
      const item = { host, button, context, parent, position, changedPosition }
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        options.onOpen(item.context)
      })
      host.addEventListener('pointerdown', (event) => event.stopPropagation())
      parent.append(host)
      owned.set(link, item)
    }
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
    })
  }
  const observer = new MutationObserver(() => {
    if (queued || stopped) return
    queued = setTimeout(() => {
      queued = undefined
      refresh()
    }, 300)
  })
  refresh()
  return {
    update(next: ScopeControlOptions) {
      options = next
      refresh()
    },
    stop() {
      stopped = true
      observer.disconnect()
      clearTimeout(queued)
      for (const link of owned.keys()) remove(link)
    },
  }
}
