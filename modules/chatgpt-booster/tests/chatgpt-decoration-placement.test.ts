import { afterEach, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { readConversationActivity } from '../packages/chatgpt/src/conversation-activity'
import {
  findConversationMessageTargets,
  observeConversationDecorations,
} from '../packages/chatgpt/src/conversation-decorators'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) await stop()
})

function workspace(id: string, hidden = false) {
  return `<div id="${id}" class="Workspace" ${hidden ? 'style="display:none"' : ''}>
    <main><div data-turn-key="${id}-turn" data-content-search-turn-key="${id}-turn">
      <div data-chatgpt-search-unit-key="${id}:user" data-chatgpt-search-message-ids="${id}-user">
        <div data-user-message-bubble="true">Synthetic user</div>
        <div class="turn-action-controls" style="opacity:0"><button aria-label="More actions"></button></div>
      </div>
      <div data-chatgpt-search-unit-key="${id}:assistant" data-chatgpt-search-message-ids="${id}-assistant" data-content-search-unit-key="${id}:assistant">
        <div data-chatgpt-selection-message-id="${id}-assistant">Synthetic assistant</div>
      </div>
    </div></main>
  </div>`
}

function setup() {
  const dom = new Window({ url: 'https://chatgpt.com/c/synthetic-placement' })
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    MutationObserver: globalThis.MutationObserver,
  }
  Object.assign(globalThis, {
    window: dom,
    document: dom.document,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver,
  })
  cleanup.push(async () => {
    Object.assign(globalThis, previous)
    await dom.happyDOM.close()
  })
  dom.document.body.innerHTML = workspace('inactive', true) + workspace('visible')
  return dom
}

test('placement skips the first hidden keepalive workspace and accepts visible native units without actions', () => {
  setup()
  const targets = findConversationMessageTargets()
  expect(targets.map((target) => target.messageId)).toEqual(['visible-user', 'visible-assistant'])
  const user = targets.find((target) => target.role === 'user')
  expect(user?.metadataMount.matches('.turn-action-controls')).toBe(true)
  expect(user?.metadataMount).toBe(user?.actions)
  const assistant = targets.find((target) => target.role === 'assistant')
  expect(assistant?.metadataMount.getAttribute('data-chatgpt-search-unit-key')).toBe('visible:assistant')
  expect(assistant?.actions).toBe(assistant?.metadataMount)
})

test('placement and activity discovery work with document-owned nodes and no global element constructors', () => {
  const dom = setup()
  Object.assign(globalThis, { Element: undefined, HTMLElement: undefined })
  const visible = dom.document.getElementById('visible') as unknown as ParentNode
  expect(findConversationMessageTargets(visible).map((target) => target.messageId)).toEqual([
    'visible-user',
    'visible-assistant',
  ])
  const placement = readConversationActivity()
  expect(placement.turnId).toBe('visible-turn')
  expect(placement.active).toBe(false)
})

test('native workspace visibility changes rescan placement and removed units can remount', async () => {
  const dom = setup()
  const seen: string[][] = []
  const observer = observeConversationDecorations((targets) => {
    seen.push(targets.map((target) => target.messageId))
  })
  cleanup.push(observer.stop)
  await dom.happyDOM.waitUntilComplete()
  expect(seen.at(-1)).toEqual(['visible-user', 'visible-assistant'])
  const inactive = dom.document.getElementById('inactive') as HTMLElement
  const visible = dom.document.getElementById('visible') as HTMLElement
  visible.style.display = 'none'
  inactive.style.display = ''
  await dom.happyDOM.waitUntilComplete()
  expect(seen.at(-1)).toEqual(['inactive-user', 'inactive-assistant'])
  const previousAssistant = findConversationMessageTargets().find(
    (target) => target.role === 'assistant',
  )
  const unit = inactive.querySelector('[data-chatgpt-search-unit-key$=":assistant"]')
  unit?.replaceWith(unit.cloneNode(true))
  await dom.happyDOM.waitUntilComplete()
  const remounted = findConversationMessageTargets().find((target) => target.role === 'assistant')
  expect(remounted?.messageId).toBe('inactive-assistant')
  expect(remounted?.message).not.toBe(previousAssistant?.message)
  expect(seen.at(-1)).toEqual(['inactive-user', 'inactive-assistant'])
})
