import type { FeatureRuntime, FeatureStatus } from '@kobaproduction/browser-core'
import { brandMark, classicThemeCss } from './theme'

export { brandMark, classicThemeCss } from './theme'
export interface ControlCenterOptions { runtime: FeatureRuntime; title?: string; launcher?: boolean }
export interface ControlCenter { open(): void; close(): void; destroy(): void }

const localCss = `
.kb-shell{position:fixed;bottom:20px;right:20px;pointer-events:auto;z-index:2147483647}
.kb-control{width:min(440px,calc(100vw - 30px))}
.kb-feature-head{display:flex;gap:10px;justify-content:space-between;align-items:center}
.kb-feature-name{font-size:14px;font-weight:730;line-height:1.3}
.kb-feature-description{margin:6px 0 11px;color:var(--kb-ink-light);font-size:12px}
.kb-feature-actions{display:flex;align-items:center;gap:11px;justify-content:space-between}
.kb-toggle{appearance:none;width:38px;height:22px;border-radius:22px;background:#cbd4e4;position:relative;cursor:pointer;transition:background .15s}
.kb-toggle::before{content:'';position:absolute;background:#fff;top:3px;left:3px;width:16px;height:16px;border-radius:50%;transition:transform .15s}
.kb-toggle:checked{background:var(--kb-accent)}
.kb-toggle:checked::before{transform:translateX(16px)}
.kb-toggle:disabled{opacity:.4}
.kb-launcher{display:flex;align-items:center;gap:9px;margin-left:auto;background:var(--kb-accent);color:#fff;border:0;padding:9px 15px;border-radius:13px;box-shadow:0 8px 24px rgb(30 62 110 / 23%);font-size:12px;font-weight:690}
.kb-launcher svg{width:20px;height:20px}
.kb-empty{padding:22px 5px;text-align:center;color:var(--kb-ink-light);font-size:13px}
@media(max-width:520px){.kb-shell{bottom:12px;right:12px}.kb-control{width:calc(100vw - 24px)}}
`

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

export function mountControlCenter(options: ControlCenterOptions): ControlCenter {
  document.getElementById('koba-browser-tools-root')?.remove()
  const host = element('div')
  host.id = 'koba-browser-tools-root'
  host.style.cssText =
    'position:fixed;inset:0;width:0;height:0;z-index:2147483646;pointer-events:none'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = '<style>' + classicThemeCss + localCss + '</style>'
  const shell = element('section', 'kb-shell')
  const panel = element('article', 'kb-window kb-control')
  const header = element('header', 'kb-header')
  const brand = element('div', 'kb-brand')
  const mark = element('span', 'kb-mark')
  mark.innerHTML = brandMark
  const brandCopy = element('div', 'kb-brand-copy')
  brandCopy.append(element('div', 'kb-eyebrow', 'Koba tools'))
  brandCopy.append(element('h2', 'kb-title', options.title ?? 'Browser Tools'))
  brand.append(mark, brandCopy)
  const closeButton = element('button', 'kb-icon-button', '×')
  closeButton.type = 'button'
  closeButton.setAttribute('aria-label', 'Закрыть центр управления')
  header.append(brand, closeButton)

  const body = element('div', 'kb-window-body')
  const summary = element('p', 'kb-description')
  summary.style.marginTop = '0'
  const list = element('div', 'kb-section')
  body.append(summary, list)
  const footer = element('footer', 'kb-footer', 'Модули управляются независимо · данные остаются в браузере')
  panel.append(header, body, footer)
  panel.hidden = true
  shell.append(panel)

  const launcher = element('button', 'kb-launcher')
  launcher.type = 'button'
  launcher.innerHTML = '<span aria-hidden="true">' + brandMark + '</span><span>Инструменты</span>'
  launcher.hidden = !options.launcher
  shell.append(launcher)
  shadow.append(shell)
  document.documentElement.append(host)

  let opened = false
  function render() {
    panel.hidden = !opened
    const statuses = options.runtime.list()
    const active = statuses.filter((item) => item.state === 'active').length
    summary.textContent =
      'Для этого сайта: ' + active + ' из ' + statuses.length + ' модулей готовы к работе.'
    list.replaceChildren()
    if (!statuses.length) {
      list.append(element('p', 'kb-empty', 'Здесь пока нет доступных модулей'))
      return
    }
    for (const item of statuses) list.append(renderFeature(item))
  }

  function renderFeature(item: FeatureStatus): HTMLElement {
    const card = element('section', 'kb-card')
    const head = element('div', 'kb-feature-head')
    head.append(element('strong', 'kb-feature-name', item.title))
    const badge = element('span', 'kb-pill' + (item.state === 'active' ? ' kb-pill-good' : ''))
    badge.textContent = item.state === 'active' ? 'Готово' :
      item.state === 'disabled' ? 'Выключен' :
      item.state === 'unsupported' ? 'Недоступен' : 'Ошибка'
    badge.title = item.reason ?? ''
    head.append(badge)
    const description = element('p', 'kb-feature-description',
      item.reason && item.state === 'failed' ? item.reason : item.description)
    const actions = element('div', 'kb-feature-actions')
    const toggleLabel = element('label', 'kb-row')
    const toggle = element('input', 'kb-toggle') as HTMLInputElement
    toggle.type = 'checkbox'
    toggle.checked = item.state !== 'disabled'
    toggle.disabled = item.state === 'unsupported'
    toggle.setAttribute('aria-label', 'Включить ' + item.title)
    const toggleText = element('span', 'kb-muted', 'Включён')
    toggle.onchange = async () => {
      toggle.disabled = true
      try { await options.runtime.setEnabled(item.id, toggle.checked) }
      finally { render() }
    }
    toggleLabel.append(toggle, toggleText)
    const openButton = element('button', 'kb-button kb-button-primary', 'Открыть модуль')
    openButton.type = 'button'
    openButton.disabled = item.state !== 'active'
    openButton.onclick = () => {
      close()
      void options.runtime.open(item.id)
    }
    actions.append(toggleLabel, openButton)
    card.append(head, description, actions)
    return card
  }

  function open() { opened = true; render() }
  function close() { opened = false; panel.hidden = true }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && opened) close()
  }
  document.addEventListener('keydown', onKeyDown)
  closeButton.onclick = close
  launcher.onclick = () => opened ? close() : open()
  render()

  return {
    open, close,
    destroy() {
      document.removeEventListener('keydown', onKeyDown)
      host.remove()
    },
  }
}
