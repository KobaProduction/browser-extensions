import type { ArchiveCurrentContext, SettingsAdapter } from '../../packages/core/src'
import { translate } from '../../packages/ui/src/i18n'
import type { ArchiveDataAdapter } from '../../packages/ui/src/mount'

const delay = () => new Promise((resolve) => setTimeout(resolve, 100))
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
        docked.click()
        await delay()
        const restored = shadow().querySelector<HTMLElement>('.booster-reader')
        assert(restored, 'archive did not restore from dock button')

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
        assert(
          restored.querySelectorAll('.booster-exchange').length === 40,
          'initial rendering is not bounded',
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
        assert(
          restored.querySelector('.booster-record-answer .booster-record-info'),
          'message timestamp/model info controls are missing',
        )
        const firstAnswer = restored.querySelector<HTMLElement>('.booster-record-answer')
        assert(
          firstAnswer?.querySelector('time')?.textContent?.trim(),
          'visible message time is missing',
        )
        assert(
          firstAnswer?.textContent?.includes(translate('ru', 'reader.editedShort')),
          'edited marker is missing',
        )
        const infoTitles = [
          ...(firstAnswer?.querySelectorAll<HTMLElement>('.booster-record-info') ?? []),
        ]
          .map((item) => item.title)
          .join('\n')
        assert(infoTitles.includes('gpt-5.6-sol'), 'model/thinking tooltip is missing')
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

        const more = [...restored.querySelectorAll<HTMLButtonElement>('button')].find(
          (item) => item.textContent?.trim() === translate('ru', 'reader.more'),
        )
        assert(more, 'show more missing')
        const expectedTurns = (await adapter.getThread(context.conversationId ?? '')).turns.length
        more.click()
        await delay()
        assert(
          restored.querySelectorAll('.booster-exchange').length === expectedTurns,
          'show more did not render remaining exchanges',
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
        await new Promise((resolve) => setTimeout(resolve, 850))
        assert(
          shadow()
            .querySelector('.booster-reader-chat-header')
            ?.textContent?.includes('Другой диалог'),
          'archive did not follow the new chat',
        )
        Object.assign(context, original)
        await new Promise((resolve) => setTimeout(resolve, 850))
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
      const textSearch = reader.querySelector<HTMLInputElement>('.booster-reader-text-search')
      assert(textSearch, 'message search missing')
      textSearch.value = 'Вопрос 55'
      textSearch.dispatchEvent(new Event('input', { bubbles: true }))
      await delay()
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
      await new Promise((resolve) => setTimeout(resolve, 180))
      const after = Number(reader.querySelector('.booster-reader-summary b')?.textContent ?? '0')
      assert(after === before + 2, 'refresh did not reread open thread')
      const exportButton = reader.querySelector<HTMLButtonElement>(
        '.booster-reader-chat-header .booster-reader-export',
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
          await delay()
          assert(
            shadow()
              .querySelector('.booster-reader')
              ?.textContent?.includes(translate('ru', 'reader.missing')),
            'missing-current-chat state not shown',
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
          await delay()
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
      } finally {
        releaseOther?.()
        adapter.getThread = originalGetThread
        await close()
      }
    })

    return result
  } finally {
    await close()
    await settings.set(previous)
  }
}
