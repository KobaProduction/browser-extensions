import type { ArchiveCurrentContext, SettingsAdapter } from '../../packages/core/src'
import { translate } from '../../packages/ui/src/i18n'
import type { ArchiveDataAdapter } from '../../packages/ui/src/mount'

const delay = () => new Promise((resolve) => setTimeout(resolve, 100))
async function waitFor(condition: () => boolean, label: string, timeoutMs = 4000) {
  const started = performance.now()
  while (!condition()) {
    if (performance.now() - started > timeoutMs) throw new Error(`Timeout waiting for ${label}`)
    await delay()
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function shadow() {
  const root = document.getElementById('chatgpt-booster-root')?.shadowRoot
  if (!root) throw new Error('Booster shadow root missing')
  return root
}
function button(selector: string) {
  const element = shadow().querySelector<HTMLButtonElement>(selector)
  if (!element) throw new Error(`Button missing: ${selector}`)
  return element
}
function bounds(element: Element) {
  const r = element.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}
export async function runUiTests(
  settings: SettingsAdapter,
  adapter: ArchiveDataAdapter,
  context: ArchiveCurrentContext,
  appendCurrentExchange: () => Promise<void>,
) {
  const result: { name: string; pass: boolean; detail?: unknown }[] = []
  const previous = await settings.get()
  async function check(name: string, fn: () => Promise<unknown>) {
    try {
      const detail = await fn()
      result.push({ name, pass: true, detail })
    } catch (error) {
      result.push({
        name,
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  async function close() {
    const minimizedArchive = shadow().querySelector<HTMLButtonElement>(
      '.booster-archive-dock-button',
    )
    if (minimizedArchive) {
      minimizedArchive.click()
      await delay()
    }
    const archiveClose = shadow().querySelector<HTMLButtonElement>(
      '.booster-reader > .booster-section-header .booster-header-actions button:last-child',
    )
    if (archiveClose) {
      archiveClose.click()
      await delay()
    }
    for (const dialog of [...shadow().querySelectorAll<HTMLElement>('.booster-dialog')].reverse()) {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await delay()
    }
    const closeBar = shadow().querySelector<HTMLButtonElement>('.booster-dock-close-bar')
    if (closeBar) {
      closeBar.click()
      await delay()
    }
  }
  try {
    await close()
    await settings.update({ launcher: { side: 'right', heightRatio: 0.65 }, language: 'ru' })
    await delay()
    await check('right edge and unified close strip, no host layout shift', async () => {
      const main = document.querySelector('main')
      assert(main, 'main missing')
      const hostBefore = bounds(main)
      const collapsed = button('.booster-dock-toggle')
      const before = bounds(collapsed)
      assert(Math.abs(before.right - innerWidth) < 1, 'not flush with right edge')
      collapsed.click()
      await delay()
      const panel = shadow().querySelector<HTMLElement>('.booster-dock-shell')
      const closeBar = shadow().querySelector<HTMLButtonElement>('.booster-dock-close-bar')
      assert(panel && closeBar, 'unified panel/close strip missing')
      assert(same(hostBefore, bounds(main)), 'host main changed geometry')
      const panelBounds = bounds(panel)
      const closeBounds = bounds(closeBar)
      assert(
        Math.abs(closeBounds.x - panelBounds.x) < 1 &&
          Math.abs(closeBounds.width - panelBounds.width) < 1,
        'close strip does not span the dock shell',
      )
      assert(
        panelBounds.x >= 0 && panelBounds.bottom <= innerHeight && panelBounds.y >= 0,
        'panel outside viewport',
      )
      assert(!panel.textContent?.includes('g-p-1111'), 'raw project ID shown as name')
      const currentThread = await adapter.getThread(context.conversationId ?? '')
      assert(
        panel.textContent?.includes(String(currentThread.messageCount)) &&
          panel.textContent?.includes(String(currentThread.detailCount)),
        'message/detail counts missing',
      )
      closeBar.click()
      await delay()
      assert(!shadow().querySelector('.booster-dock-shell'), 'close strip did not close dock')
      assert(shadow().querySelector('.booster-dock-toggle'), 'collapsed toggle did not return')
      return { viewport: [innerWidth, innerHeight], anchor: before }
    })
    await check(
      'pointer handler drop snaps left and persists height ratio (synthetic pointer)',
      async () => {
        await close()
        const toggle = button('.booster-dock-toggle'),
          before = bounds(toggle)
        const x = before.x + 22,
          y = before.y + 22,
          targetY = (innerHeight - 44) * 0.2 + 22
        toggle.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 41,
            button: 0,
            bubbles: true,
            clientX: x,
            clientY: y,
          }),
        )
        toggle.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 41,
            button: 0,
            bubbles: true,
            clientX: 22,
            clientY: targetY,
          }),
        )
        toggle.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: 41,
            button: 0,
            bubbles: true,
            clientX: 22,
            clientY: targetY,
          }),
        )
        toggle.click()
        await delay()
        const saved = (await settings.get()).launcher
        assert(
          saved.side === 'left' && Math.abs(saved.heightRatio - 0.2) < 0.002,
          'dock preference incorrect',
        )
        assert(bounds(toggle).x === 0, 'not flush left')
        assert(toggle.getAttribute('aria-expanded') === 'false', 'drag toggled panel')
        toggle.click()
        await delay()
        const panel = shadow().querySelector('.booster-dock-shell')
        assert(panel, 'no left panel')
        assert(bounds(panel).x === 0 && bounds(panel).bottom <= innerHeight, 'left panel overflows')
        assert(
          shadow().querySelector('.booster-dock.grow-down'),
          'panel did not choose downward space',
        )
        await close()
        return { side: saved.side, ratio: saved.heightRatio }
      },
    )
    await check(
      'Escape restores toggle focus and touch pointer drag persists an edge',
      async () => {
        await close()
        const toggle = button('.booster-dock-toggle')
        toggle.click()
        await delay()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await delay()
        const collapsed = button('.booster-dock-toggle')
        assert(collapsed.getAttribute('aria-expanded') === 'false', 'Escape did not close dock')
        assert(shadow().activeElement === collapsed, 'Escape did not restore toggle focus')

        const before = bounds(collapsed)
        const targetY = (innerHeight - 44) * 0.72 + 22
        for (const [type, x, y] of [
          ['pointerdown', before.x + 22, before.y + 22],
          ['pointermove', innerWidth - 22, targetY],
          ['pointerup', innerWidth - 22, targetY],
        ] as const)
          collapsed.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 77,
              pointerType: 'touch',
              button: 0,
              bubbles: true,
              clientX: x,
              clientY: y,
            }),
          )
        collapsed.click()
        await delay()
        const saved = (await settings.get()).launcher
        assert(saved.side === 'right', 'touch drag did not snap to right edge')
        assert(
          Math.abs(saved.heightRatio - 0.72) < 0.01,
          'touch drag height ratio was not persisted',
        )
        assert(
          button('.booster-dock-toggle').getAttribute('aria-expanded') === 'false',
          'touch drag toggled dock',
        )
        return { side: saved.side, ratio: saved.heightRatio }
      },
    )

    await check(
      'archive is a movable/minimizable workspace with Markdown and compact internal records',
      async () => {
        await close()
        const main = document.querySelector('main')
        assert(main, 'main missing')
        const hostBefore = bounds(main)
        button('.booster-dock-toggle').click()
        await delay()
        button('.booster-dock-actions > button:nth-child(3)').click()
        await delay()
        const workspace = shadow().querySelector<HTMLElement>('.booster-archive-workspace')
        const reader = shadow().querySelector<HTMLElement>('.booster-reader')
        assert(workspace && reader, 'floating archive workspace missing')
        assert(
          !reader.closest('.booster-modal-backdrop'),
          'archive still blocks the host as a modal',
        )
        assert(same(hostBefore, bounds(main)), 'archive workspace changed host layout')

        const beforeWindow = bounds(workspace)
        const dragHandle = reader.querySelector<HTMLElement>('[data-archive-drag-handle]')
        assert(dragHandle, 'archive drag handle missing')
        dragHandle.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 301,
            button: 0,
            bubbles: true,
            clientX: beforeWindow.x + 100,
            clientY: beforeWindow.y + 20,
          }),
        )
        dragHandle.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 301,
            button: 0,
            bubbles: true,
            clientX: beforeWindow.x + 145,
            clientY: beforeWindow.y + 55,
          }),
        )
        dragHandle.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: 301,
            button: 0,
            bubbles: true,
            clientX: beforeWindow.x + 145,
            clientY: beforeWindow.y + 55,
          }),
        )
        await delay()
        const movedWindow = bounds(workspace)
        assert(
          movedWindow.x !== beforeWindow.x || movedWindow.y !== beforeWindow.y,
          'archive did not move',
        )

        const resize = workspace.querySelector<HTMLElement>('[data-archive-resize]')
        assert(resize, 'archive resize handle missing')
        resize.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 302,
            button: 0,
            bubbles: true,
            clientX: movedWindow.right - 2,
            clientY: movedWindow.bottom - 2,
          }),
        )
        resize.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 302,
            button: 0,
            bubbles: true,
            clientX: movedWindow.right - 42,
            clientY: movedWindow.bottom - 32,
          }),
        )
        resize.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: 302,
            button: 0,
            bubbles: true,
            clientX: movedWindow.right - 42,
            clientY: movedWindow.bottom - 32,
          }),
        )
        await delay()
        assert(
          bounds(workspace).width < movedWindow.width ||
            bounds(workspace).height < movedWindow.height,
          'archive did not resize',
        )

        const minimize = reader.querySelector<HTMLButtonElement>('[aria-label="Свернуть архив"]')
        assert(minimize, 'archive minimize control missing')
        minimize.click()
        await delay()
        const docked = shadow().querySelector<HTMLButtonElement>('.booster-archive-dock-button')
        assert(
          docked && !shadow().querySelector('.booster-reader'),
          'archive did not minimize into its own dock button',
        )
        const dockRect = bounds(docked)
        docked.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 303,
            button: 0,
            bubbles: true,
            clientX: dockRect.x + 20,
            clientY: dockRect.y + 20,
          }),
        )
        docked.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: 303,
            button: 0,
            bubbles: true,
            clientX: 16,
            clientY: innerHeight * 0.3,
          }),
        )
        docked.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: 303,
            button: 0,
            bubbles: true,
            clientX: 16,
            clientY: innerHeight * 0.3,
          }),
        )
        await delay()
        assert(bounds(docked).x === 0, 'minimized archive did not snap to left edge')
        assert(
          (await settings.get()).ui.archiveWindow.minimizedSide === 'left',
          'minimized archive side was not persisted',
        )
        docked.click()
        await delay()
        assert(
          !shadow().querySelector('.booster-reader'),
          'drag release incorrectly restored archive',
        )
        window.dispatchEvent(
          new CustomEvent('chatgpt-booster:open-archive', {
            detail: { conversationId: context.conversationId },
          }),
        )
        await delay()
        const restored = shadow().querySelector<HTMLElement>('.booster-reader')
        assert(restored, 'reopening archive while minimized did not restore the workspace')

        const projects = [...restored.querySelectorAll<HTMLButtonElement>('.booster-group-toggle')]
        const activeProject = projects.find((item) =>
          item.textContent?.includes('Koba Infrastructure'),
        )
        const otherProject = projects.find((item) => item.textContent?.includes('Другой проект'))
        assert(
          activeProject?.getAttribute('aria-expanded') === 'true' &&
            otherProject?.getAttribute('aria-expanded') === 'false',
          'wrong expanded projects',
        )
        await waitFor(
          () => restored.querySelectorAll('.booster-exchange').length > 0,
          'initial archive turns',
        )
        assert(
          restored.querySelectorAll('.booster-exchange').length === 40,
          `initial rendering is not bounded: ${restored.querySelectorAll('.booster-exchange').length}`,
        )
        const viewport = restored.querySelector<HTMLElement>('.booster-reader-scroll')
        const pinned = restored.querySelector<HTMLElement>('.booster-reader-pinned')
        assert(viewport && pinned, 'reader must have separate fixed controls and scroll viewport')
        assert(
          Math.abs(viewport.scrollTop - (viewport.scrollHeight - viewport.clientHeight)) < 3,
          'reading does not start on the latest exchange',
        )
        const mostRecentTurn = (await adapter.getThread(context.conversationId ?? '')).turns.at(-1)
        const mostRecentQuestion =
          mostRecentTurn?.messages.find((item) => item.kind === 'user')?.text ?? ''
        assert(mostRecentQuestion, 'fixture has no latest user message')
        assert(
          restored
            .querySelector('.booster-exchange:last-child')
            ?.textContent?.includes(mostRecentQuestion),
          'latest exchange is not visible initially',
        )
        const pinnedBefore = bounds(pinned)
        viewport.scrollTop = 0
        viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
        const expectedTurns = (await adapter.getThread(context.conversationId ?? '')).turns.length
        await waitFor(
          () => restored.querySelectorAll('.booster-exchange').length === expectedTurns,
          'incremental older-turn load',
        )
        assert(
          restored.querySelectorAll('.booster-exchange').length === expectedTurns,
          'scrolling toward history did not load older exchanges',
        )
        assert(
          viewport.scrollTop > 0,
          'prepending older exchanges did not preserve the scroll anchor',
        )
        assert(
          same(bounds(pinned), pinnedBefore),
          'scrolling messages moved the pinned reader controls',
        )
        assert(
          restored.querySelector('.booster-record-reasoning'),
          'reasoning preview is not visible',
        )
        assert(
          restored.querySelector('.booster-record-tool_call'),
          'tool-call preview is not visible',
        )
        const toolCall = restored.querySelector<HTMLElement>('.booster-record-tool_call')
        assert(
          toolCall?.textContent?.includes('Koba GitHub') &&
            toolCall.textContent.includes('get file'),
          'nested MCP tool name was not resolved from functions.exec payload',
        )
        assert(
          toolCall?.querySelector<HTMLAnchorElement>('.booster-tool-action[href*="github.com"]'),
          'tool source link is missing',
        )
        assert(
          restored.querySelector('.booster-record-tool_result'),
          'tool-result preview is not visible',
        )
        assert(
          restored.querySelector('.booster-tool-icon:not(.booster-tool-icon-fallback)'),
          'tool icon was not rendered',
        )
        assert(
          restored.querySelector('.booster-record-answer .booster-markdown h2'),
          'Markdown heading was not rendered',
        )
        assert(
          restored.querySelector('.booster-record-answer .booster-markdown strong'),
          'Markdown bold was not rendered',
        )
        assert(
          restored.querySelector('.booster-record-answer .booster-markdown code'),
          'Markdown inline code was not rendered',
        )
        assert(
          restored.querySelector('.booster-record-answer .booster-markdown li'),
          'Markdown list was not rendered',
        )
        assert(
          !restored.querySelector('textarea,[contenteditable="true"],form'),
          'reader contains a composer or edit form',
        )

        const reasoningToggle = [
          ...restored.querySelectorAll<HTMLButtonElement>('.booster-reader-chat-actions button'),
        ].find((item) => item.textContent?.includes('Развернуть размышления'))
        assert(reasoningToggle, 'global reasoning toggle missing')
        reasoningToggle.click()
        await delay()
        assert(
          restored.querySelector('.booster-reasoning-preview.expanded'),
          'reasoning did not expand globally',
        )

        assert(
          ![
            ...restored.querySelectorAll<HTMLButtonElement>('.booster-record-tool_call button'),
          ].some((item) => item.textContent?.trim() === 'Run'),
          'obsolete Run control is still visible',
        )
        const firstAnswer = restored.querySelector<HTMLElement>('.booster-record-answer')
        const metadataTriggers = [
          ...(firstAnswer?.querySelectorAll<HTMLElement>('.booster-meta-trigger') ?? []),
        ]
        assert(metadataTriggers.length >= 2, 'message timestamp/model info controls are missing')
        assert(
          !firstAnswer?.querySelector('time'),
          'message timestamp should stay icon-only until hover/focus',
        )
        assert(
          firstAnswer?.textContent?.includes(translate('ru', 'reader.editedShort')),
          'edited marker is missing',
        )
        const metadataLabels = metadataTriggers
          .map((item) => item.getAttribute('aria-label') ?? '')
          .join('\\n')
        assert(metadataLabels.includes('gpt-5.6-sol'), 'model/thinking popover metadata is missing')
        assert(
          metadataLabels.includes(translate('ru', 'reader.sentAt')),
          'timestamp popover metadata is missing',
        )
        metadataTriggers[0]?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        await delay()
        const popover = firstAnswer?.querySelector<HTMLElement>('.booster-floating-popover')
        assert(popover, 'timestamp top-layer popover is missing')
        assert(
          popover.matches(':popover-open'),
          'timestamp popover did not enter the browser top layer',
        )
        metadataTriggers[0]?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
        await delay()
        const raw = restored.querySelector<HTMLButtonElement>(
          '.booster-record-answer .booster-record-icon-button',
        )
        assert(raw, 'raw metadata control missing')
        raw.click()
        await delay()
        const dialog = shadow().querySelector<HTMLElement>('.booster-dialog')
        assert(dialog, 'raw JSON modal missing')
        assert(
          dialog.querySelector('.booster-json-viewer .booster-json-key'),
          'syntax-highlighted JSON modal missing',
        )
        const jsonModal = dialog.querySelector<HTMLElement>('.booster-json-modal')
        const jsonViewer = dialog.querySelector<HTMLElement>('.booster-json-viewer')
        assert(jsonModal && jsonViewer, 'JSON layout containers missing')
        assert(
          Math.abs(jsonModal.getBoundingClientRect().width - dialog.clientWidth) < 1,
          'JSON modal does not fill dialog content width',
        )
        assert(
          jsonViewer.clientWidth <= jsonModal.clientWidth &&
            jsonViewer.scrollWidth >= jsonViewer.clientWidth,
          'JSON viewer overflow escaped its modal',
        )
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await delay()

        assert(
          ![...restored.querySelectorAll<HTMLButtonElement>('button')].some(
            (item) => item.textContent?.trim() === translate('ru', 'reader.more'),
          ),
          'manual show-more control should be replaced by continuous reading',
        )
        assert(
          !restored.querySelector('.booster-archive-flow-graph'),
          'history must be closed initially',
        )
        const readerSurface = restored.querySelector<HTMLElement>('.booster-reader-reading-surface')
        const readerScroll = restored.querySelector<HTMLElement>('.booster-reader-scroll')
        assert(readerSurface && readerScroll, 'reader layout missing')
        const readerWidth = readerScroll.getBoundingClientRect().width
        assert(
          Math.abs(readerWidth - readerSurface.getBoundingClientRect().width) < 2,
          'closed history still reserves a reader gutter',
        )
        const toggle = restored.querySelector<HTMLButtonElement>('.booster-reader-history-toggle')
        assert(toggle, 'history action missing')
        toggle.click()
        await waitFor(
          () => Boolean(restored.querySelector('.booster-history-list-row')),
          'unlinked saved chronology',
        )
        const nav = restored.querySelector<HTMLElement>('.booster-archive-flow-graph')
        assert(nav, 'history inspector missing')
        assert(
          Math.abs(readerScroll.getBoundingClientRect().width - readerWidth) < 2,
          'opening history unexpectedly shrunk the message viewport',
        )
        const chronologicalRows = [
          ...nav.querySelectorAll<HTMLButtonElement>('.booster-history-list-row'),
        ]
        assert(
          chronologicalRows[0]?.textContent?.includes('Вопрос 1') &&
            chronologicalRows[1]?.textContent?.includes('Ответ 1') &&
            chronologicalRows[2]?.textContent?.includes('Вопрос 2'),
          'unlinked history lost conversation turn order',
        )
        assert(
          nav.querySelectorAll('.booster-history-list-row').length <= 140 &&
            !nav.querySelector('svg circle[id]'),
          'partial history should use chronology, not disconnected graph stems',
        )
        assert(
          ![...restored.querySelectorAll('.booster-reader-chat-actions button')].some((item) =>
            /Новые сверху|Старые сверху/.test(item.textContent ?? ''),
          ),
          'obsolete sorting control is still visible',
        )
        const firstSaved = nav.querySelector<HTMLButtonElement>(
          '.booster-history-list-row[data-archive-history-key="user-000"]',
        )
        assert(firstSaved, 'first saved chronology row missing')
        firstSaved.click()
        await delay()
        assert(
          restored.querySelectorAll('.booster-exchange').length <= 40,
          'jump to earliest endpoint rendered all intervening exchanges',
        )
        assert(
          restored
            .querySelector('.booster-exchange:first-child')
            ?.textContent?.includes('Вопрос 1'),
          'earliest saved exchange did not open',
        )
        otherProject.click()
        await delay()
        assert(
          otherProject.getAttribute('aria-expanded') === 'true',
          'other project cannot be expanded',
        )

        const archiveClose = restored.querySelector<HTMLButtonElement>(
          '.booster-header-actions button:last-child',
        )
        archiveClose?.click()
        await delay()
        assert(
          !shadow().querySelector('.booster-archive-workspace'),
          'archive close did not fully close workspace',
        )
        const finalThread = await adapter.getThread(context.conversationId ?? '')
        return {
          moved: movedWindow,
          messages: finalThread.messageCount,
          details: finalThread.detailCount,
        }
      },
    )

    await check(
      'archive follows ChatGPT SPA conversation changes while it stays open',
      async () => {
        await close()
        button('.booster-dock-toggle').click()
        await delay()
        button('.booster-dock-actions > button:nth-child(3)').click()
        await delay()
        const original = { ...context }
        Object.assign(context, {
          conversationId: 'fixture-other',
          conversationTitle: 'Другой диалог',
          projectId: 'g-p-22222222222222222222222222222222',
          projectTitle: 'Другой проект · тест',
        })
        await waitFor(
          () =>
            Boolean(
              shadow()
                .querySelector('.booster-reader-chat-header')
                ?.textContent?.includes('Другой диалог'),
            ),
          'SPA next chat',
        )
        assert(
          shadow()
            .querySelector('.booster-reader-chat-header')
            ?.textContent?.includes('Другой диалог'),
          'archive did not follow the new chat',
        )
        Object.assign(context, original)
        await waitFor(
          () =>
            Boolean(
              shadow()
                .querySelector('.booster-reader-chat-header')
                ?.textContent?.includes('Проверка панели и архива'),
            ),
          'SPA original chat',
        )
        assert(
          shadow()
            .querySelector('.booster-reader-chat-header')
            ?.textContent?.includes('Проверка панели и архива'),
          'archive did not return to current chat',
        )
        await close()
      },
    )

    await check(
      'selective saving opens as a dedicated surface without unrelated settings',
      async () => {
        await close()
        button('.booster-dock-toggle').click()
        await delay()
        button('.booster-capture-shortcut').click()
        await delay()
        const capture = shadow().querySelector<HTMLElement>('.booster-capture-surface')
        assert(capture, 'dedicated capture surface missing')
        assert(
          !capture.querySelector('.booster-settings-nav'),
          'capture surface still contains full settings navigation',
        )
        assert(
          !capture.textContent?.includes('Телеметрия') && !capture.textContent?.includes('Язык'),
          'unrelated settings leaked into capture surface',
        )
        capture
          .querySelector<HTMLButtonElement>('.booster-section-header .booster-icon-button')
          ?.click()
        await delay()
        await close()
      },
    )

    await check('analytics renders as a compact activity dashboard', async () => {
      await close()
      button('.booster-dock-toggle').click()
      await delay()
      button('.booster-dock-actions > button:nth-child(4)').click()
      await delay()
      const center = shadow().querySelector<HTMLElement>('.booster-control-center')
      assert(center, 'settings missing')
      const analytics = [
        ...center.querySelectorAll<HTMLButtonElement>('.booster-settings-nav button'),
      ].find((item) => item.textContent?.includes('Аналитика'))
      assert(analytics, 'analytics navigation missing')
      analytics.click()
      await delay()
      assert(center.querySelector('.booster-analytics-dashboard'), 'analytics dashboard missing')
      assert(
        center.querySelectorAll('.booster-analytics-metrics article').length === 3,
        'analytics summary metrics missing',
      )
      assert(
        center.querySelectorAll('.booster-analytics-flow-card').length === 2,
        'analytics flow cards missing',
      )
      center.querySelector<HTMLButtonElement>('.booster-header-actions .size-8')?.click()
      await delay()
      await close()
    })

    await check('English locale and identifier copy work', async () => {
      await close()
      await settings.update({ language: 'en' })
      await delay()
      button('.booster-dock-toggle').click()
      await delay()
      const panel = shadow().querySelector<HTMLElement>('.booster-dock-shell')
      assert(panel, 'panel missing')
      assert(panel.textContent?.includes('Browse archive'), 'English labels missing')
      const copy = panel.querySelector<HTMLButtonElement>('.booster-identity-copy')
      assert(copy, 'copy control missing')
      copy.focus()
      assert(getComputedStyle(copy).opacity === '1', 'copy control hidden on focus')
      let copied = ''
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value: string) => {
              copied = value
            },
          },
        })
        copy.click()
        await delay()
        assert(copied === context.conversationId, 'wrong identifier copied')
      } finally {
        if (original) Object.defineProperty(navigator, 'clipboard', original)
        else Reflect.deleteProperty(navigator, 'clipboard')
      }
      await close()
      return { copied: true, language: 'en' }
    })

    await check('SPA context refresh discards a late previous-chat response', async () => {
      await close()
      await settings.update({ language: 'ru' })
      const originalContext = { ...context }
      const originalGet = adapter.getCurrentContext
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      try {
        Object.assign(context, {
          conversationId: 'fixture-slow',
          conversationTitle: 'Медленный старый чат',
          projectId: null,
          projectTitle: null,
        })
        adapter.getCurrentContext = async () => {
          const snapshot = { ...context }
          if (snapshot.conversationId === 'fixture-slow') await gate
          return snapshot
        }
        button('.booster-dock-toggle').click()
        await new Promise((resolve) => setTimeout(resolve, 80))
        Object.assign(context, {
          conversationId: 'fixture-fast',
          conversationTitle: 'Новый быстрый чат',
          projectId: null,
          projectTitle: null,
        })
        await new Promise((resolve) => setTimeout(resolve, 1200))
        release?.()
        await new Promise((resolve) => setTimeout(resolve, 180))
        const text = shadow().querySelector('.booster-dock-shell')?.textContent ?? ''
        assert(text.includes('Новый быстрый чат'), 'new SPA context not rendered')
        assert(!text.includes('Медленный старый чат'), 'stale context overwrote new chat')
      } finally {
        release?.()
        adapter.getCurrentContext = originalGet
        Object.assign(context, originalContext)
        await close()
      }
    })

    await check('archive search, refresh and selected-chat export stay consistent', async () => {
      await close()
      button('.booster-dock-toggle').click()
      await delay()
      button('.booster-dock-actions > button:nth-child(3)').click()
      await delay()
      const reader = shadow().querySelector<HTMLElement>('.booster-reader')
      assert(reader, 'archive missing')
      const listSearch = reader.querySelector<HTMLInputElement>(
        '.booster-reader-sidebar input[type="search"]',
      )
      assert(listSearch, 'list search missing')
      listSearch.value = 'Другой проект'
      listSearch.dispatchEvent(new Event('input', { bubbles: true }))
      await delay()
      assert(
        reader.querySelectorAll('.booster-reader-group').length === 1,
        'project/chat search failed',
      )
      listSearch.value = ''
      listSearch.dispatchEvent(new Event('input', { bubbles: true }))
      await delay()
      const openFind = reader.querySelector<HTMLButtonElement>(
        '.booster-reader-chat-actions button:last-child',
      )
      assert(openFind, 'collapsed message search toggle missing')
      openFind.click()
      await delay()
      const textSearch = reader.querySelector<HTMLInputElement>(
        '.booster-reader-find input[type="search"]',
      )
      assert(textSearch, 'message search missing')
      textSearch.value = 'Вопрос 55'
      textSearch.dispatchEvent(new Event('input', { bubbles: true }))
      await waitFor(
        () => reader.querySelectorAll('.booster-exchange').length === 1,
        'filtered message render',
      )
      assert(reader.querySelectorAll('.booster-exchange').length === 1, 'message search failed')
      textSearch.value = ''
      textSearch.dispatchEvent(new Event('input', { bubbles: true }))
      await delay()
      const before = Number(reader.querySelector('.booster-reader-summary b')?.textContent ?? '0')
      await appendCurrentExchange()
      const refresh = reader.querySelector<HTMLButtonElement>(
        '.booster-section-header .booster-icon-button',
      )
      assert(refresh, 'refresh button missing')
      refresh.click()
      await waitFor(
        () =>
          Number(reader.querySelector('.booster-reader-summary b')?.textContent ?? '0') ===
          before + 2,
        'reread saved exchange',
      )
      const after = Number(reader.querySelector('.booster-reader-summary b')?.textContent ?? '0')
      assert(after === before + 2, 'refresh did not reread open thread')
      const exportButton = reader.querySelector<HTMLButtonElement>(
        '.booster-reader-chat-actions .booster-reader-export',
      )
      assert(exportButton, 'archive export button missing')
      exportButton.click()
      await delay()
      const dialog = shadow().querySelector<HTMLElement>('.booster-export-dialog')
      assert(dialog, 'selected chat did not open export dialog')
      assert(dialog.textContent?.includes(context.conversationTitle ?? ''), 'wrong export target')
      const selectors = [...dialog.querySelectorAll<HTMLSelectElement>('select')]
      const [formatSelect, levelSelect] = selectors
      assert(formatSelect && levelSelect, 'format/level selectors missing')
      const expectedFormats = adapter.listExportFormats()
      assert(
        JSON.stringify([...formatSelect.options].map((option) => option.value)) ===
          JSON.stringify(expectedFormats.map((format) => format.id)),
        'format selector is not driven by the export registry',
      )
      levelSelect.value = 'full'
      levelSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await delay()
      assert(
        dialog.querySelector<HTMLButtonElement>('.booster-action-primary')?.disabled === false,
        'full package export remained disabled',
      )
      assert(formatSelect.isConnected, 'full mode removed format selector')
      dialog.querySelector<HTMLButtonElement>('.booster-icon-button')?.click()
      await delay()
      await close()
      return { before, after }
    })

    await check(
      'prepared JSON and Markdown exports contain the selected browser payload',
      async () => {
        await close()
        button('.booster-dock-toggle').click()
        await delay()
        button('.booster-dock-actions > button:nth-child(1)').click()
        await delay()
        const dialog = shadow().querySelector<HTMLElement>('.booster-export-dialog')
        assert(dialog, 'export dialog missing')
        const exportDialog = dialog
        const [format, level] = [...exportDialog.querySelectorAll<HTMLSelectElement>('select')]
        assert(format && level, 'export selectors missing')
        const formatSelect = format
        level.value = 'conversation'
        level.dispatchEvent(new Event('change', { bubbles: true }))

        async function prepare(formatValue: 'json' | 'markdown') {
          formatSelect.value = formatValue
          formatSelect.dispatchEvent(new Event('change', { bubbles: true }))
          await delay()
          const prepareButton =
            exportDialog.querySelector<HTMLButtonElement>('.booster-action-primary')
          assert(prepareButton, 'prepare button missing')
          prepareButton.click()
          await delay()
          const ready = exportDialog.querySelector<HTMLAnchorElement>('.booster-export-ready')
          assert(ready, 'prepared download link missing')
          const response = await fetch(ready.href)
          assert(response.ok, 'prepared blob URL was unreadable in browser')
          return { text: await response.text(), name: ready.download }
        }

        const json = await prepare('json')
        const parsed = JSON.parse(json.text)
        assert(parsed.schema === 'chatgpt-booster.export.v1', 'JSON export schema missing')
        assert(json.name.endsWith('.json'), 'JSON download filename extension incorrect')

        const markdown = await prepare('markdown')
        assert(markdown.text.startsWith('# '), 'Markdown export body missing heading')
        assert(markdown.name.endsWith('.md'), 'Markdown download filename extension incorrect')
        await close()

        button('.booster-dock-toggle').click()
        await delay()
        button('.booster-dock-actions > button:nth-child(1)').click()
        await delay()
        const reopened = shadow().querySelector<HTMLElement>('.booster-export-dialog')
        assert(reopened, 'export dialog did not reopen')
        const [rememberedFormat, rememberedLevel] = [
          ...reopened.querySelectorAll<HTMLSelectElement>('select'),
        ]
        assert(
          rememberedFormat?.value === 'markdown' && rememberedLevel?.value === 'conversation',
          'last export format/level were not remembered',
        )
        await close()
        return { jsonBytes: json.text.length, markdownBytes: markdown.text.length }
      },
    )

    await check(
      'archive loading, empty, missing-current and error states are explicit',
      async () => {
        await close()
        const originalContext = { ...context }
        const originalListConversations = adapter.listConversations
        const originalListProjects = adapter.listProjects
        try {
          Object.assign(context, {
            conversationId: 'fixture-unsaved',
            conversationTitle: 'Несохранённый чат',
            projectId: null,
            projectTitle: null,
          })
          button('.booster-dock-toggle').click()
          await new Promise((resolve) => setTimeout(resolve, 1100))
          button('.booster-dock-actions > button:nth-child(3)').click()
          await waitFor(
            () =>
              Boolean(
                shadow()
                  .querySelector('.booster-reader')
                  ?.textContent?.includes(translate('ru', 'reader.missing')),
              ),
            'missing conversation state',
          )
          assert(
            shadow()
              .querySelector('.booster-reader')
              ?.textContent?.includes(translate('ru', 'reader.missing')),
            `missing-current-chat state not shown: ${shadow().querySelector('.booster-reader')?.textContent?.slice(-190)}`,
          )
          await close()

          let releaseList: (() => void) | undefined
          const gate = new Promise<void>((resolve) => {
            releaseList = resolve
          })
          adapter.listConversations = async () => {
            await gate
            return []
          }
          adapter.listProjects = async () => []
          button('.booster-dock-toggle').click()
          await delay()
          button('.booster-dock-actions > button:nth-child(3)').click()
          await new Promise((resolve) => setTimeout(resolve, 25))
          assert(
            shadow()
              .querySelector('.booster-reader')
              ?.textContent?.includes(translate('ru', 'reader.loading')),
            'loading state missing',
          )
          releaseList?.()
          await waitFor(
            () =>
              Boolean(
                shadow()
                  .querySelector('.booster-reader')
                  ?.textContent?.includes(translate('ru', 'reader.empty')),
              ),
            'empty archive list',
          )
          assert(
            shadow()
              .querySelector('.booster-reader')
              ?.textContent?.includes(translate('ru', 'reader.empty')),
            'empty state missing',
          )
          await close()

          adapter.listConversations = async () => {
            throw new Error('fixture read failure')
          }
          button('.booster-dock-toggle').click()
          await delay()
          button('.booster-dock-actions > button:nth-child(3)').click()
          await delay()
          assert(shadow().querySelector('.booster-reader .booster-error'), 'error state missing')
          await close()
        } finally {
          adapter.listConversations = originalListConversations
          adapter.listProjects = originalListProjects
          Object.assign(context, originalContext)
          await close()
        }
      },
    )

    await check('archive ignores a late thread result after fast chat switching', async () => {
      await close()
      button('.booster-dock-toggle').click()
      await delay()
      button('.booster-dock-actions > button:nth-child(3)').click()
      await delay()
      const reader = shadow().querySelector<HTMLElement>('.booster-reader')
      assert(reader, 'archive missing')
      const originalGetThread = adapter.getThread
      let releaseOther: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        releaseOther = resolve
      })
      adapter.getThread = async (id) => {
        if (id === 'fixture-other') await gate
        return await originalGetThread(id)
      }
      try {
        const otherGroup = [
          ...reader.querySelectorAll<HTMLButtonElement>('.booster-group-toggle'),
        ].find((item) => item.textContent?.includes('Другой проект'))
        assert(otherGroup, 'other project group missing')
        if (otherGroup.getAttribute('aria-expanded') !== 'true') otherGroup.click()
        await delay()
        const otherChat = [
          ...reader.querySelectorAll<HTMLButtonElement>('.booster-reader-chat-list button'),
        ].find((item) => item.textContent?.includes('Другой диалог'))
        const currentChat = [
          ...reader.querySelectorAll<HTMLButtonElement>('.booster-reader-chat-list button'),
        ].find((item) => item.textContent?.includes('Проверка панели и архива'))
        assert(otherChat && currentChat, 'chat buttons missing')
        otherChat.click()
        await new Promise((resolve) => setTimeout(resolve, 20))
        currentChat.click()
        await new Promise((resolve) => setTimeout(resolve, 100))
        releaseOther?.()
        await delay()
        assert(
          reader
            .querySelector('.booster-reader-chat-header')
            ?.textContent?.includes('Проверка панели и архива'),
          'late other-chat result replaced current chat',
        )
        await waitFor(
          () =>
            Boolean(
              reader.querySelector<HTMLButtonElement>(
                '.booster-reader-history-toggle:not(:disabled)',
              ),
            ),
          'restored history action is enabled',
        )
        const toggle = reader.querySelector<HTMLButtonElement>('.booster-reader-history-toggle')
        assert(toggle, 'history toggle missing after chat switching')
        toggle.click()
        await waitFor(
          () => Boolean(reader.querySelector('.booster-archive-flow-graph')),
          'restored history inspector',
        )
        assert(
          reader.querySelectorAll('.booster-history-list-row, svg circle[id]').length <= 140,
          'rapid switching restored an overcrowded inspector',
        )
      } finally {
        releaseOther?.()
        adapter.getThread = originalGetThread
        await close()
      }
    })

    await check(
      'archive branch forest renders nested depth and ancestor-aware search',
      async () => {
        await close()
        await settings.update({ language: 'ru' })
        const originalListConversations = adapter.listConversations
        const baseline = await originalListConversations()
        const root = baseline.find((item) => item.conversationId === context.conversationId)
        assert(root, 'fixture source conversation missing')
        const branch = {
          ...root,
          conversationId: 'fixture-browser-branch',
          title: 'Ветка продукта',
          branchSourceConversationId: root.conversationId,
          branchSourceTitle: root.title,
        }
        const nested = {
          ...root,
          conversationId: 'fixture-browser-nested',
          title: 'Вложенная ветка продукта',
          branchSourceConversationId: branch.conversationId,
          branchSourceTitle: branch.title,
        }
        adapter.listConversations = async () => [...baseline, branch, nested]
        try {
          button('.booster-dock-toggle').click()
          await delay()
          button('.booster-dock-actions > button:nth-child(3)').click()
          await delay()
          const reader = shadow().querySelector<HTMLElement>('.booster-reader')
          assert(reader, 'archive browser missing')
          const project = [
            ...reader.querySelectorAll<HTMLButtonElement>('.booster-group-toggle'),
          ].find((item) => item.textContent?.includes('Koba Infrastructure'))
          assert(project, 'fixture project missing')
          if (project.getAttribute('aria-expanded') !== 'true') project.click()
          await delay()
          const rows = [
            ...reader.querySelectorAll<HTMLButtonElement>('.booster-reader-chat-list button'),
          ]
          const rootRow = rows.find((item) => item.textContent?.includes(root.title ?? '#none'))
          const branchRow = rows.find((item) => item.textContent?.includes(branch.title))
          const nestedRow = rows.find((item) => item.textContent?.includes(nested.title))
          assert(rootRow && branchRow && nestedRow, 'tree is missing one branch generation')
          assert(
            Number.parseFloat(rootRow.style.paddingInlineStart) <
              Number.parseFloat(branchRow.style.paddingInlineStart) &&
              Number.parseFloat(branchRow.style.paddingInlineStart) <
                Number.parseFloat(nestedRow.style.paddingInlineStart),
            'nested conversations have no increasing depth',
          )
          assert(
            branchRow.querySelector('.booster-reader-branch-icon') &&
              nestedRow.querySelector('.booster-reader-branch-icon'),
            'nested rows lack branch signifiers',
          )
          const searchInput = reader.querySelector<HTMLInputElement>(
            '.booster-reader-sidebar > input',
          )
          assert(searchInput, 'archive project search missing')
          searchInput.value = nested.title
          searchInput.dispatchEvent(new Event('input', { bubbles: true }))
          await delay()
          const matched = [
            ...reader.querySelectorAll<HTMLButtonElement>('.booster-reader-chat-list button'),
          ]
          assert(matched.length === 3, 'search did not preserve exactly the known ancestor chain')
          assert(
            matched.some((item) => item.textContent?.includes(root.title ?? '#none')) &&
              matched.some((item) => item.textContent?.includes(branch.title)) &&
              matched.some((item) => item.textContent?.includes(nested.title)),
            'search lost branch ancestry',
          )
          matched.find((item) => item.textContent?.includes(nested.title))?.click()
          await delay()
          assert(
            reader
              .querySelector('.booster-reader-chat-header')
              ?.textContent?.includes(nested.title),
            'nested branch is not selectable',
          )
          return { nestedDepth: 2, searchAncestors: 2 }
        } finally {
          adapter.listConversations = originalListConversations
          await close()
        }
      },
    )

    await check(
      'Free-shaped fixture renders two internal message forks in the fixed navigator',
      async () => {
        await close()
        button('.booster-dock-toggle').click()
        await delay()
        button('.booster-dock-actions > button:nth-child(3)').click()
        await delay()
        const reader = shadow().querySelector<HTMLElement>('.booster-reader')
        assert(reader, 'archive missing for synthetic Free branching example')
        await waitFor(
          () => Boolean(reader.querySelector('.booster-reader-group')),
          'archive groups',
        )
        const fixtureProject = [
          ...reader.querySelectorAll<HTMLButtonElement>('.booster-group-toggle'),
        ].find((item) => item.textContent?.includes('Koba Infrastructure'))
        if (fixtureProject?.getAttribute('aria-expanded') !== 'true') fixtureProject?.click()
        await waitFor(
          () =>
            Boolean(
              [
                ...reader.querySelectorAll<HTMLButtonElement>('.booster-reader-chat-list button'),
              ].find((item) => item.textContent?.includes('Две внутренние ветки')),
            ),
          'fixture fork chat entry',
        )
        const forkChat = [
          ...reader.querySelectorAll<HTMLButtonElement>('.booster-reader-chat-list button'),
        ].find((item) => item.textContent?.includes('Две внутренние ветки'))
        assert(forkChat, 'fixture internal branch conversation not listed')
        forkChat.click()
        await waitFor(() => {
          const currentReader = shadow().querySelector<HTMLElement>('.booster-reader')
          return Boolean(
            currentReader
              ?.querySelector('.booster-reader-chat-header')
              ?.textContent?.includes('Две внутренние ветки') &&
              currentReader.querySelector<HTMLButtonElement>(
                '.booster-reader-history-toggle:not(:disabled)',
              ),
          )
        }, 'selected fork conversation ready')
        const activeReader = shadow().querySelector<HTMLElement>('.booster-reader')
        assert(activeReader, 'archive unmounted while selecting fork')
        const historyToggle = activeReader.querySelector<HTMLButtonElement>(
          '.booster-reader-history-toggle',
        )
        assert(historyToggle, 'fork history toggle missing')
        historyToggle.click()
        await waitFor(
          () => Boolean(activeReader.querySelector('.booster-archive-flow-graph svg circle[id]')),
          'fork graph',
        )
        const nav = activeReader.querySelector<HTMLElement>('.booster-archive-flow-graph')
        assert(nav, 'internal-branch message navigation rail missing')
        const dots = () => [...nav.querySelectorAll<SVGCircleElement>('svg circle[id]')]
        await waitFor(
          () =>
            dots().length >= 8 &&
            dots().every((node) => {
              const group = node.closest('defs')?.parentElement
              return (
                group?.getAttribute('tabindex') === '0' &&
                group.getAttribute('role') === 'button' &&
                !!group.getAttribute('aria-label')
              )
            }),
          'accessible GitGraph message nodes',
        )
        const forks = dots()
        assert(
          nav.querySelectorAll('.booster-gitgraph-segment').length === 1,
          'confirmed fork paths were split into disconnected segments',
        )
        assert(nav.querySelectorAll('svg path').length >= 2, 'verified fork connectors missing')
        assert(
          forks.some((node) => Boolean(node.id)),
          'fork node lacks message preview',
        )
        const switcher = activeReader.querySelector<HTMLButtonElement>(
          '.booster-reader-fork-toggle',
        )
        assert(switcher, 'fork variant switcher is absent')
        switcher.click()
        await delay()
        const variants = [
          ...activeReader.querySelectorAll<HTMLButtonElement>('.booster-reader-fork-choice'),
        ]
        assert(
          variants.length === 4,
          'two fork groups do not offer exactly four saved alternatives',
        )
        variants.find((item) => item.textContent?.includes('редакция (ветка 2)'))?.click()
        await delay()
        assert(
          activeReader.textContent?.includes('Вопрос 3 · редакция (ветка 2)'),
          'selected variant did not open for reading',
        )
        const first = nav
          .querySelector<SVGCircleElement>('svg circle[id="f-u1"]')
          ?.closest('defs')?.parentElement
        assert(first?.getAttribute('role') === 'button', 'first node has no keyboard interaction')
        first.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
        )
        await waitFor(
          () => Boolean(activeReader.textContent?.includes('Начало экспериментального диалога')),
          'keyboard-selected GitGraph node opened its saved conversation record',
        )
        await waitFor(
          () =>
            nav.querySelector('g[data-archive-graph-node="f-u1"]')?.getAttribute('aria-current') ===
            'true',
          'keyboard-selected GitGraph node highlight',
        )
        await delay()
        assert(
          activeReader.querySelectorAll('.booster-exchange').length < 20,
          'fork click mounted unrelated history',
        )
        return { forkPoints: 2, forkNodes: forks.length }
      },
    )

    await check('long connected GitGraph stays bounded without horizontal overflow', async () => {
      await close()
      const openLong = document.querySelector<HTMLButtonElement>('#fixture-open-long')
      assert(openLong, 'long-history fixture trigger unavailable')
      openLong.click()
      await waitFor(
        () =>
          Boolean(
            shadow()
              .querySelector<HTMLElement>('.booster-reader')
              ?.textContent?.includes('Длинный связный диалог'),
          ),
        'long conversation',
      )
      await waitFor(
        () =>
          Boolean(
            shadow()
              .querySelector('.booster-reader-chat-header')
              ?.textContent?.includes('Длинный связный диалог') &&
              shadow().querySelector<HTMLButtonElement>(
                '.booster-reader-history-toggle:not(:disabled)',
              ),
          ),
        'long conversation reading is ready',
      )
      const reader = shadow().querySelector<HTMLElement>('.booster-reader')
      const toggle = reader?.querySelector<HTMLButtonElement>('.booster-reader-history-toggle')
      assert(toggle, 'long history toggle missing')
      toggle.click()
      await waitFor(
        () =>
          Boolean(
            reader
              ?.querySelector('.booster-history-range')
              ?.textContent?.includes('161–300 / 300') &&
              reader.querySelectorAll('.booster-archive-flow-graph svg circle[id]').length === 140,
          ),
        '300-message bounded inspector',
        10000,
      )
      const graph = reader?.querySelector<HTMLElement>('.booster-archive-flow-graph')
      assert(graph, 'long-history inspector missing')
      assert(
        graph.scrollWidth <= graph.clientWidth + 1,
        'single-linked history unnecessarily overflows the graph horizontally',
      )
      const earlier = graph.querySelector<HTMLButtonElement>('button[aria-label="Ранее в графе"]')
      assert(earlier && !earlier.disabled, 'long-history earlier graph action unavailable')
      earlier.click()
      await waitFor(
        () =>
          Boolean(
            graph.querySelector('.booster-history-range')?.textContent?.includes('21–160 / 300'),
          ),
        'earlier 140-node graph window',
      )
      assert(
        graph.querySelectorAll('svg circle[id]').length === 140,
        'earlier graph window exceeded bounded node count',
      )
      return { records: 300, mounted: 140, graphWidth: graph.clientWidth }
    })

    return result
  } finally {
    await close()
    await settings.set(previous)
  }
}
