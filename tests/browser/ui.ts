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
    for (
      let i = 0;
      i < 2 && button('.booster-dock-toggle').getAttribute('aria-expanded') === 'true';
      i++
    ) {
      button('.booster-dock-toggle').click()
      await delay()
    }
  }
  try {
    await close()
    await settings.update({ launcher: { side: 'right', heightRatio: 0.65 }, language: 'ru' })
    await delay()
    await check(
      'right edge and stable toggle, no host layout shift, repeated click closes',
      async () => {
        const main = document.querySelector('main')
        assert(main, 'main missing')
        const hostBefore = bounds(main),
          before = bounds(button('.booster-dock-toggle'))
        assert(Math.abs(before.right - innerWidth) < 1, 'not flush with right edge')
        button('.booster-dock-toggle').click()
        await delay()
        const panel = shadow().querySelector('.booster-dock-shell')
        assert(panel, 'panel missing')
        assert(same(before, bounds(button('.booster-dock-toggle'))), 'toggle moved on expand')
        assert(same(hostBefore, bounds(main)), 'host main changed geometry')
        assert(
          bounds(panel).x >= 0 && bounds(panel).bottom <= innerHeight && bounds(panel).y >= 0,
          'panel outside viewport',
        )
        assert(!panel.textContent?.includes('g-p-1111'), 'raw project ID shown as name')
        const currentThread = await adapter.getThread(context.conversationId ?? '')
        assert(
          panel.textContent?.includes(String(currentThread.messageCount)) &&
            panel.textContent?.includes(String(currentThread.detailCount)),
          'reply/detail counts missing',
        )
        button('.booster-dock-toggle').click()
        await delay()
        assert(!shadow().querySelector('.booster-dock-shell'), 'repeat click did not close')
        return { viewport: [innerWidth, innerHeight], anchor: before }
      },
    )
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
        assert(toggle.getAttribute('aria-expanded') === 'false', 'Escape did not close dock')
        assert(shadow().activeElement === toggle, 'Escape did not restore toggle focus')

        const before = bounds(toggle)
        const targetY = (innerHeight - 44) * 0.72 + 22
        for (const [type, x, y] of [
          ['pointerdown', before.x + 22, before.y + 22],
          ['pointermove', innerWidth - 22, targetY],
          ['pointerup', innerWidth - 22, targetY],
        ] as const)
          toggle.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 77,
              pointerType: 'touch',
              button: 0,
              bubbles: true,
              clientX: x,
              clientY: y,
            }),
          )
        toggle.click()
        await delay()
        const saved = (await settings.get()).launcher
        assert(saved.side === 'right', 'touch drag did not snap to right edge')
        assert(
          Math.abs(saved.heightRatio - 0.72) < 0.01,
          'touch drag height ratio was not persisted',
        )
        assert(toggle.getAttribute('aria-expanded') === 'false', 'touch drag toggled dock')
        return { side: saved.side, ratio: saved.heightRatio }
      },
    )

    await check(
      'archive opens current project only, nested records are lazy, no composer',
      async () => {
        await close()
        button('.booster-dock-toggle').click()
        await delay()
        button('.booster-dock-actions > button:nth-child(3)').click()
        await delay()
        const reader = shadow().querySelector('.booster-reader')
        assert(reader, 'no archive')
        const projects = [...reader.querySelectorAll<HTMLButtonElement>('.booster-group-toggle')]
        const active = projects.find((p) => p.textContent?.includes('Koba Infrastructure'))
        const other = projects.find((p) => p.textContent?.includes('Другой проект'))
        assert(
          active?.getAttribute('aria-expanded') === 'true' &&
            other?.getAttribute('aria-expanded') === 'false',
          'wrong expanded projects',
        )
        assert(
          reader.querySelectorAll('.booster-exchange').length === 40,
          'initial rendering is not bounded to 40 exchanges',
        )
        assert(
          !reader.querySelector('.booster-record-tool_result'),
          'nested details rendered before opening',
        )
        const disclosure = reader.querySelector<HTMLDetailsElement>('.booster-exchange-details')
        assert(disclosure, 'no disclosure')
        disclosure.open = true
        await delay()
        assert(reader.querySelector('.booster-record-tool_result'), 'nested tool record missing')
        assert(
          !reader.querySelector('textarea,[contenteditable="true"],form'),
          'reader contains a composer or edit form',
        )
        const buttons = [...reader.querySelectorAll<HTMLButtonElement>('button')]
        const more = buttons.find((b) => b.textContent?.trim() === translate('ru', 'reader.more'))
        assert(more, 'show more missing')
        const expectedTurns = (await adapter.getThread(context.conversationId ?? '')).turns.length
        more.click()
        await delay()
        assert(
          reader.querySelectorAll('.booster-exchange').length === expectedTurns,
          'show more did not render remaining exchanges',
        )
        other.click()
        await delay()
        assert(other.getAttribute('aria-expanded') === 'true', 'other project cannot be expanded')
        await close()
        const finalThread = await adapter.getThread(context.conversationId ?? '')
        return {
          initialExchanges: 40,
          expandedExchanges: expectedTurns,
          replyCount: finalThread.messageCount,
          nestedCount: finalThread.detailCount,
        }
      },
    )
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
        '.booster-reader-chat-header .booster-action-secondary',
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
