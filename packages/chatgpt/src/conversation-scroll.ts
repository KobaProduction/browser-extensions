export function currentConversationId(href = location.href): string | undefined {
  try {
    const url = new URL(href)
    const match = url.pathname.match(/^\/c\/([^/?#]+)/)
    return match?.[1] ? decodeURIComponent(match[1]) : undefined
  } catch {
    return undefined
  }
}

function isScrollable(element: HTMLElement): boolean {
  const style = getComputedStyle(element)
  return element.scrollHeight > element.clientHeight + 80 && /(auto|scroll)/.test(style.overflowY)
}

export function findConversationScrollContainer(
  root: ParentNode = document,
): HTMLElement | undefined {
  let best: { element: HTMLElement; score: number } | undefined

  for (const element of root.querySelectorAll<HTMLElement>('div, main, section')) {
    if (!isScrollable(element)) continue
    if (element.closest('#chatgpt-booster-root, [data-chatgpt-booster]')) continue

    const turnCount = element.querySelectorAll('[data-testid^="conversation-turn-"]').length
    const messageCount = element.querySelectorAll('[data-message-author-role]').length
    if (turnCount === 0 && messageCount === 0) continue

    let score = Math.min(turnCount, 50) * 5 + Math.min(messageCount, 100)
    if (element.classList.contains('group/scroll-root')) score += 30
    if (element.clientHeight >= window.innerHeight * 0.5) score += 20
    if (element.closest('main')) score += 10

    if (!best || score > best.score) best = { element, score }
  }

  return best?.element
}
