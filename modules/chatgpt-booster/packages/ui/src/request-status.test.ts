import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { AgentActivitySnapshot } from '@chatgpt-booster/core'
import { Window } from 'happy-dom'
import ts from 'typescript'
import { ensureSiteDecoration } from '../../../../../packages/ui/src/site-decoration'
import * as i18n from './i18n'
import type { mountRequestStatus } from './request-status'

const source = readFileSync(new URL('./request-status.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const output: { mountRequestStatus?: typeof mountRequestStatus } = {}
new Function('exports', 'require', js)(output, (id: string) => {
  if (id === '@kobaproduction/browser-ui') return { ensureSiteDecoration }
  if (id === './i18n') return i18n
  if (id === './shadow-styles') return { installBoosterShadowStyles() {} }
  throw Error(`Unexpected dependency ${id}`)
})
const mount = output.mountRequestStatus
if (!mount) throw Error('Request status module missing')
const previousDocument = globalThis.document
const windows: Window[] = []
afterEach(async () => {
  globalThis.document = previousDocument
  for (const window of windows.splice(0)) await window.happyDOM.close()
})
function fixture() {
  const window = new Window()
  windows.push(window)
  globalThis.document = window.document as unknown as Document
  const anchor = document.createElement('div')
  document.body.append(anchor)
  const now = Date.now()
  const model: AgentActivitySnapshot = {
    conversationId: 'synthetic',
    turnId: 'synthetic',
    active: true,
    phase: 'thinking',
    startedAt: now - 90_000,
    completedAt: null,
    reasoningStartedAt: now - 60_000,
    phaseStartedAt: now - 60_000,
    lastActivityAt: now - 8_000,
    lastSummaryAt: now - 12_000,
    previousSummaryAt: now - 22_000,
    durationMs: null,
    reasoningDurationMs: null,
    label: null,
    tool: null,
  }
  return { anchor, model, now }
}

test('status shows three relevant counters without wall-clock time or duplicate phase rows', () => {
  const { anchor, model, now } = fixture()
  const mounted = mount(anchor, model, 'ru')
  mounted.tick(now)
  const bar = mounted.element.shadowRoot?.querySelector('.booster-request-status')
  expect(bar).not.toBeNull()
  const visible = [...(bar?.children ?? [])].filter((e) => !(e as HTMLElement).hidden)
  expect(visible.map((e) => e.textContent).filter(Boolean)).toEqual([
    'Запрос1:30',
    'Размышление1:00',
    'Без изменений8s назад',
  ])
  expect(bar?.getAttribute('aria-label')).not.toContain('Обновлено')
  expect(bar?.getAttribute('aria-label')).not.toContain('После сводки')
  expect(bar?.getAttribute('title')).toContain('После сводки')
  mounted.update({ ...model, phase: 'tool' })
  expect(bar?.getAttribute('aria-label')).toContain('Действие')
  expect(bar?.getAttribute('aria-label')).not.toContain('Размышление')
  mounted.unmount()
})

test('terminal snapshot freezes elapsed values instead of counting indefinitely', () => {
  const { anchor, model, now } = fixture()
  const mounted = mount(anchor, { ...model, active: false, phase: 'complete', completedAt: now }, 'ru')
  const bar = mounted.element.shadowRoot?.querySelector('.booster-request-status')
  const before = bar?.getAttribute('aria-label')
  mounted.tick(now + 28 * 60 * 60 * 1000)
  expect(bar?.getAttribute('aria-label')).toBe(before)
  mounted.unmount()
})
