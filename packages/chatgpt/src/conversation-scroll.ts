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
  if (element.clientHeight < 80 || element.scrollHeight <= element.clientHeight + 4) return false
  const overflowY = getComputedStyle(element).overflowY
  return /(auto|scroll|hidden|clip)/.test(overflowY) || element.scrollTop > 0
}

function scrollCandidateScore(
  element: HTMLElement,
  message: HTMLElement | null,
): number {
  let score = 0
  if (element.matches('[class~="group/scroll-root"]')) score += 50
  if (element.matches('[data-scroll-root], [data-testid*="scroll" i]')) score += 24
  if (message && element.contains(message)) score += 20
  const style = getComputedStyle(element)
  if (/(auto|scroll)/.test(style.overflowY)) score += 16
  if (element.scrollTop > 0) score += 8
  const rect = element.getBoundingClientRect()
  if (rect.top <= innerHeight * 0.25 && rect.bottom >= innerHeight * 0.65) score += 6
  score += Math.min(12, Math.round((element.clientHeight / Math.max(1, innerHeight)) * 12))
  return score
}

/**
 * Locate the actual conversation viewport. ChatGPT changes wrapper classes often, so the
 * stable contract is "scrollable ancestor of a real turn", not one CSS class.
 */
export function findConversationScrollContainer(
  root: ParentNode = document,
): HTMLElement | undefined {
  const message = root.querySelector<HTMLElement>(
    'main [data-message-id][data-message-author-role], main [data-testid^="conversation-turn-"]',
  )
  const candidates = new Set<HTMLElement>()

  for (const known of root.querySelectorAll<HTMLElement>(
    '[class~="group/scroll-root"], [data-scroll-root], [data-testid*="scroll" i]',
  ))
    candidates.add(known)

  let ancestor = message?.parentElement ?? null
  while (ancestor) {
    candidates.add(ancestor)
    ancestor = ancestor.parentElement
  }

  const main = document.querySelector<HTMLElement>('main')
  ancestor = main?.parentElement ?? null
  while (ancestor) {
    candidates.add(ancestor)
    ancestor = ancestor.parentElement
  }

  const ranked = [...candidates]
    .filter(isConversationScroller)
    .sort((a, b) => scrollCandidateScore(b, message ?? null) - scrollCandidateScore(a, message ?? null))

  if (ranked[0]) return ranked[0]

  const scrolling = document.scrollingElement
  if (scrolling instanceof HTMLElement && isConversationScroller(scrolling)) return scrolling
  return undefined
}

export function scrollConversationTowardStart(container: HTMLElement): {
  moved: boolean
  atStart: boolean
  before: number
  after: number
} {
  const before = container.scrollTop
  if (before <= 1) return { moved: false, atStart: true, before, after: before }

  const step = Math.min(
    Math.max(420, Math.round(container.clientHeight * 0.85)),
    Math.max(420, before),
  )
  const target = Math.max(0, before - step)
  container.scrollTo({ top: target, behavior: 'instant' })
  if (Math.abs(container.scrollTop - before) < 1) container.scrollTop = target

  const after = container.scrollTop
  return {
    moved: after < before - 1,
    atStart: after <= 1,
    before,
    after,
  }
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

export function currentConversationMessageBounds(root: ParentNode = document): {
  firstMessageId: string | null
  lastMessageId: string | null
} {
  const ids = [
    ...root.querySelectorAll<HTMLElement>(
      'main [data-message-id][data-message-author-role="user"], main [data-message-id][data-message-author-role="assistant"]',
    ),
  ]
    .map((element) => element.dataset.messageId?.trim() || '')
    .filter(Boolean)
  return {
    firstMessageId: ids[0] ?? null,
    lastMessageId: ids.at(-1) ?? null,
  }
}
