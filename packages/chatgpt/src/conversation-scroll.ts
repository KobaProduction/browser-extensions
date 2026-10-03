export function currentConversationId(href = location.href): string | undefined {
  try {
    const url = new URL(href)
    const match = url.pathname.match(/(?:^|\/)c\/([^/?#]+)/)
    return match?.[1] ? decodeURIComponent(match[1]) : undefined
  } catch {
    return undefined
  }
}

function isConversationScroller(element: HTMLElement): boolean {
  if (element.closest('nav, aside, form, #chatgpt-booster-root, [data-chatgpt-booster]'))
    return false
  const main = document.querySelector('main')
  if (!main || (!main.contains(element) && !element.contains(main))) return false
  const style = getComputedStyle(element)
  return (
    element.clientHeight > 0 &&
    element.scrollHeight > element.clientHeight + 1 &&
    /(auto|scroll)/.test(style.overflowY)
  )
}

/** Select the actual overflow ancestor of a conversation turn, never its movable content child. */
export function findConversationScrollContainer(
  root: ParentNode = document,
): HTMLElement | undefined {
  const known = root.querySelectorAll<HTMLElement>('[class~="group/scroll-root"]')
  for (const candidate of known) if (isConversationScroller(candidate)) return candidate
  const message = root.querySelector<HTMLElement>(
    'main [data-message-author-role], main [data-testid^="conversation-turn-"]',
  )
  let candidate = message?.parentElement
  while (candidate) {
    if (isConversationScroller(candidate)) return candidate
    candidate = candidate.parentElement
  }
  return undefined
}

export function currentProjectId(href = location.href): string | undefined {
  try {
    return new URL(href).pathname.match(/^\/g\/(g-p-[a-f0-9]{32})(?:[-/]|$)/i)?.[1]
  } catch {
    return undefined
  }
}

export function hasConversationDraft(root: ParentNode = document): boolean {
  const composer = root.querySelector<HTMLElement>('main [contenteditable="true"], main textarea')
  return !!(composer instanceof HTMLTextAreaElement
    ? composer.value.trim()
    : composer?.textContent?.trim())
}

export function hasPendingComposerAttachments(root: ParentNode = document): boolean {
  const form = root.querySelector<HTMLFormElement>('main form')
  if (!form) return false
  const fileInput = form.querySelector<HTMLInputElement>('input[type="file"]')
  if (fileInput?.files?.length) return true
  for (const element of form.querySelectorAll<HTMLElement>(
    '[data-testid], [data-state], img, a[download]',
  )) {
    const testId = element.dataset.testid?.toLowerCase() ?? ''
    const state = element.dataset.state?.toLowerCase() ?? ''
    if (/file-thumbnail|image-thumbnail|attachment/.test(testId)) return true
    if (/uploading|pending/.test(state)) return true
    if (element instanceof HTMLImageElement) {
      const source = element.currentSrc || element.src
      if (/^(blob:|data:)|\/backend-api\/(?:files|uploads)\//.test(source)) return true
    }
  }
  return false
}

export function currentProjectTitle(
  projectId: string,
  root: ParentNode = document,
): string | undefined {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href*="/g/"]')) {
    if (currentProjectId(link.href) !== projectId) continue
    try {
      if (!new URL(link.href, location.href).pathname.endsWith('/project')) continue
    } catch {
      continue
    }
    const title = link.textContent?.trim()
    if (title) return title
  }
  return undefined
}

export function currentConversationTitle(root: Document = document): string | undefined {
  let title = root.title.trim()
  const projectId = currentProjectId()
  const project = projectId ? currentProjectTitle(projectId, root) : undefined
  if (project && title.startsWith(`${project} - `)) title = title.slice(project.length + 3)
  title = title.replace(/ - ChatGPT$/, '').trim()
  return title && title !== 'ChatGPT' ? title : undefined
}
export function isConversationGenerating(root: ParentNode = document): boolean {
  return !!root.querySelector('[data-testid="stop-button"], [data-testid="stop-generation"]')
}

export function currentResolvedAssetUrls(root: ParentNode = document) {
  const resolved = new Map<string, string>()
  for (const element of root.querySelectorAll<HTMLImageElement | HTMLAnchorElement>(
    'img[src*="/backend-api/estuary/content"], a[href*="/backend-api/estuary/content"]',
  )) {
    const value =
      element instanceof HTMLImageElement ? element.currentSrc || element.src : element.href
    try {
      const url = new URL(value, location.href)
      const assetId = url.searchParams.get('id')
      if (
        url.origin === 'https://chatgpt.com' &&
        url.pathname === '/backend-api/estuary/content' &&
        assetId?.startsWith('file_')
      )
        resolved.set(assetId, url.href)
    } catch {
      // Ignore malformed or non-ChatGPT URLs.
    }
  }
  return [...resolved].map(([assetId, downloadUrl]) => ({ assetId, downloadUrl }))
}
