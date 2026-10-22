import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import * as core from '@kobaproduction/browser-core'
import { Window } from 'happy-dom'
import ts from 'typescript'
import { ensureSiteDecoration, type SiteDecorationOptions } from './site-decoration'

const windows: Window[] = []
afterEach(async () => {
  for (const window of windows.splice(0)) await window.happyDOM.close()
})

function setup(placement: 'append' | 'before' = 'append') {
  const window = new Window()
  windows.push(window)
  const anchor = window.document.createElement('section') as unknown as HTMLElement
  window.document.body.append(anchor)
  let created = 0
  let removed = 0
  let value = 1
  const options: SiteDecorationOptions<{
    element: HTMLElement
    update(value: number): void
    unmount(): void
  }> = {
    anchor,
    kind: 'test:timer',
    placement,
    legacySelector: '[data-old-timer]',
    create() {
      created++
      const element = window.document.createElement('span') as unknown as HTMLElement
      element.textContent = String(value)
      if (placement === 'append') anchor.append(element)
      else anchor.before(element)
      return {
        element,
        update(next) {
          element.textContent = String(next)
        },
        unmount() {
          removed++
          element.remove()
        },
      }
    },
    update(current) {
      current.update(value)
    },
  }
  return {
    window,
    anchor,
    options,
    set: (next: number) => {
      value = next
    },
    counts: () => ({ created, removed }),
  }
}

test('independently loaded bundle reuses the DOM-owned mount and updates it', () => {
  const source = readFileSync(new URL('./site-decoration.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports: Record<string, typeof ensureSiteDecoration> = {}
  new Function('exports', 'require', js)(exports, () => core)
  const fixture = setup()
  const first = ensureSiteDecoration(fixture.options)
  fixture.set(42)
  const second = exports.ensureSiteDecoration(fixture.options)
  expect(second).toBe(first)
  expect(first.element.textContent).toBe('42')
  expect(fixture.anchor.children.length).toBe(1)
  expect(fixture.counts()).toEqual({ created: 1, removed: 0 })
}, 20_000)

test('removes old and cloned duplicates without touching nested/native elements or other kinds', () => {
  const fixture = setup()
  fixture.anchor.innerHTML =
    '<span data-old-timer></span><div><span data-old-timer></span></div><span data-site-decoration="test:tools"></span>'
  const first = ensureSiteDecoration(fixture.options)
  fixture.anchor.append(first.element.cloneNode(true))
  ensureSiteDecoration(fixture.options)
  expect(fixture.anchor.querySelectorAll('[data-site-decoration="test:timer"]').length).toBe(1)
  expect(fixture.anchor.querySelectorAll('[data-old-timer]').length).toBe(1)
  expect(fixture.anchor.querySelector('[data-site-decoration="test:tools"]')).not.toBeNull()
})

test('native removal remounts once; repeated stale disposal cannot remove its replacement', () => {
  const fixture = setup()
  const old = ensureSiteDecoration(fixture.options)
  old.element.remove()
  const current = ensureSiteDecoration(fixture.options)
  old.unmount()
  old.unmount()
  expect(current.element.parentElement).toBe(fixture.anchor)
  expect(fixture.counts()).toEqual({ created: 2, removed: 1 })
  current.unmount()
  expect(fixture.counts().removed).toBe(2)
})

test('different anchors and different purposes have independent mounts', () => {
  const a = setup()
  const b = setup()
  const first = ensureSiteDecoration(a.options)
  const second = ensureSiteDecoration(b.options)
  const tools = ensureSiteDecoration({ ...a.options, kind: 'test:tools' })
  expect(first).not.toBe(second)
  expect(first).not.toBe(tools)
  expect(a.anchor.children.length).toBe(2)
  expect(b.anchor.children.length).toBe(1)
})

test('before-anchor placement reconciles multiple injected kinds without crossing native siblings', () => {
  const fixture = setup('before')
  const timer = ensureSiteDecoration(fixture.options)
  const warning = ensureSiteDecoration({ ...fixture.options, kind: 'test:warning' })
  timer.element.after(timer.element.cloneNode(true))
  ensureSiteDecoration(fixture.options)
  expect(fixture.window.document.querySelectorAll('[data-site-decoration="test:timer"]').length).toBe(1)
  expect(warning.element.isConnected).toBe(true)
  const native = fixture.window.document.createElement('div')
  fixture.anchor.before(native)
  const replacement = ensureSiteDecoration(fixture.options)
  expect(replacement).not.toBe(timer)
  expect(native.isConnected).toBe(true)
})

test('identity changes dispose subscriptions before replacing the presentation', () => {
  const fixture = setup()
  const first = ensureSiteDecoration({ ...fixture.options, identity: 'en' })
  const second = ensureSiteDecoration({ ...fixture.options, identity: 'ru' })
  expect(first).not.toBe(second)
  expect(fixture.counts()).toEqual({ created: 2, removed: 1 })
  expect(fixture.anchor.children.length).toBe(1)
})

test('installations never adopt or remove another channel mount', () => {
  const fixture = setup()
  const dev = ensureSiteDecoration({ ...fixture.options, scope: 'all-in-one:dev:userscript' })
  const prod = ensureSiteDecoration({ ...fixture.options, scope: 'all-in-one:prod:userscript' })
  expect(dev).not.toBe(prod)
  ensureSiteDecoration({ ...fixture.options, scope: 'all-in-one:dev:userscript' })
  expect(fixture.anchor.children.length).toBe(2)
  dev.unmount()
  expect(prod.element.isConnected).toBe(true)
})
