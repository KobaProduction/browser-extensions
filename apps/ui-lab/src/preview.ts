/** Browser-only isolated synthetic preview; imports the actual Shell and provider Vue views. */

import { createRuntimeTelemetry } from '@kobaproduction/browser-adapters'
import {
  type Feature,
  FeatureRuntime,
  FeatureSettings,
  type SettingsStore,
  SHELL_OPEN_FEATURE_EVENT,
  shellInstanceKey,
} from '@kobaproduction/browser-core'
import { watch } from 'vue'
import chatgptDefinition from '../../../modules/chatgpt-booster/module.json'
import ChatGptPanel from '../../../modules/chatgpt-booster/src/features/archive/ui/ChatGptPanel.vue'
import {
  chatGptRequestedSection,
  chatGptSafeView,
  chatGptViewContext,
  setChatGptSafeView,
} from '../../../modules/chatgpt-booster/src/index'
import vkDefinition from '../../../modules/vk-booster/module.json'
import {
  vkActiveView,
  vkRequestedView,
} from '../../../modules/vk-booster/src/features/chat-export/model/ui-navigation'
import ArchivePanel from '../../../modules/vk-booster/src/features/chat-export/ui/ArchivePanel.vue'
import { mountControlCenter } from '../../../packages/shell/src/mount'
import aggregateDefinition from '../../all-in-one.json'
import { createLabAutomation } from './automation'
import { createLabBackup } from './backup'
import { mountDemoSite } from './demo-site'
import {
  createMockChatGptArchive,
  createMockCounters,
  createMockSettingsAdapter,
  createMockVkArchive,
  fixtureSize,
} from './fixtures'
import { findPlatformSettingsNav, settingsNavigationWarnings } from './navigation-diagnostics'
import { readLabSettingsCategory } from './presentation'
import { readScenario } from './scenes'
import { createLabTelemetry } from './telemetry'
import './preview.css'

// A synthetic Lab identity is not an allocated product release.
const labVersion = '0.0.0-lab'
const chatgptManifest = { ...chatgptDefinition, version: labVersion }
const vkManifest = { ...vkDefinition, version: labVersion }
const aggregateManifest = { ...aggregateDefinition, version: labVersion }
const scene = readScenario(location.search)
const matrixId = new URLSearchParams(location.search).get('matrix')
const runInteractions = new URLSearchParams(location.search).get('probe') === '1'
const browserErrors: string[] = []
window.addEventListener('error', (event) =>
  browserErrors.push(`Browser exception: ${event.message.slice(0, 180)}`),
)
window.addEventListener('unhandledrejection', (event) =>
  browserErrors.push(`Unhandled rejection: ${String(event.reason).slice(0, 180)}`),
)
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const vkHost = scene.product === 'vk' || scene.product === 'all-in-one-vk'
const inConversation = !vkHost || new URLSearchParams(location.search).get('page') !== 'home'
const hostUrl = new URL(
  vkHost
    ? inConversation
      ? 'https://vk.com/im?sel=9001'
      : 'https://vk.com/feed'
    : 'https://chatgpt.com/c/demo-dialog',
)
const target = scene.method === 'tampermonkey' ? ('userscript' as const) : ('chromium' as const)
const installLabel = scene.method === 'tampermonkey' ? 'Tampermonkey' : 'Chromium MV3'
const c = createMockChatGptArchive(scene.scene)
const vk = createMockVkArchive(scene.scene, scene.method, inConversation)
const settingsAdapter = createMockSettingsAdapter()
const requestedSection = new URLSearchParams(location.search).get('section')
const resume = new URLSearchParams(location.search).get('resume')
const resumedSection = new URLSearchParams(location.search).get('settingsSection')
const settingsSection =
  (['modules', 'archive', 'analytics', 'other', 'sounds', 'triggers', 'remote'] as const).find(
    (section) => section === (resumedSection ?? requestedSection),
  ) ?? 'modules'
let currentSettingsSection: typeof settingsSection = settingsSection
void settingsAdapter.update({ ui: { activeSection: settingsSection } })
const transport = createMockCounters(fixtureSize(scene.scene))
const stored = new Map<string, boolean | string>()
// Deterministic fixture language; actual installations default to browser language.
stored.set('ui.language', new URLSearchParams(location.search).get('language') || 'ru')
stored.set('ui.launcher.enabled', new URLSearchParams(location.search).get('launcher') !== 'off')
stored.set('ui.site-entry.enabled', new URLSearchParams(location.search).get('siteEntry') === 'on')
stored.set('ui.quick-menu.enabled', new URLSearchParams(location.search).get('quickMenu') !== 'off')
stored.set('ui.metrics.enabled', new URLSearchParams(location.search).get('metrics') !== 'off')
if (scene.scene === 'disabled') stored.set('installation.enabled', false)
const settingsStore: SettingsStore = {
  async getText(key) {
    const value = stored.get(key)
    return typeof value === 'string' ? value : undefined
  },
  async setText(key, value) {
    stored.set(key, value)
  },
  async get(key) {
    const value = stored.get(key)
    return typeof value === 'boolean' ? value : undefined
  },
  async set(key, value) {
    stored.set(key, value)
  },
}

function reveal(id: string, section?: string) {
  if (id === 'chatgpt-booster') {
    const view = section === 'settings' || section === 'capture' ? section : 'archive'
    setChatGptSafeView(view)
    chatGptRequestedSection.value = (section || 'archive') as typeof chatGptRequestedSection.value
  }
  if (id === 'vk-booster')
    vkRequestedView.value = (
      section === 'archive' ? 'reader' : section || 'capture'
    ) as typeof vkRequestedView.value
  window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id } }))
}

let automationFixture: ReturnType<typeof createLabAutomation> | undefined
const chatgpt: Feature = {
  id: 'chatgpt-booster',
  title: 'ChatGPT Booster',
  description: 'История, оригинальные метаданные и аналитика',
  descriptionEn: 'History, source metadata and analytics',
  presentation: {
    panel: 'wide',
    version: '2.0.19',
    installation: installLabel,
    onViewHidden: () => {
      chatGptRequestedSection.value = null
    },
  },
  launcher: { mode: 'quick-menu' },
  settings: {
    categories: [
      { id: 'archive', title: 'Сохранение', titleEn: 'Capture' },
      { id: 'modules', title: 'Модули', titleEn: 'Modules' },
      { id: 'sounds', title: 'Звуки', titleEn: 'Sounds' },
      { id: 'triggers', title: 'Триггеры', titleEn: 'Triggers' },
      { id: 'remote', title: 'Сервер и синхронизация', titleEn: 'Server and sync' },
      { id: 'analytics', title: 'Аналитика', titleEn: 'Analytics' },
    ],
    currentCategory() {
      return chatGptSafeView.value === 'settings'
        ? currentSettingsSection === 'other'
          ? 'modules'
          : currentSettingsSection
        : ''
    },
    subscribe(listener) {
      const stop = settingsAdapter.subscribe((next) => {
        currentSettingsSection = next.ui.activeSection
        listener()
      })
      const stopView = watch(chatGptSafeView, listener)
      return () => {
        stop()
        stopView()
      }
    },
    async restoreCategory(id) {
      if (!['archive', 'modules', 'sounds', 'analytics', 'other', 'triggers', 'remote'].includes(id))
        return
      setChatGptSafeView('settings')
      currentSettingsSection = (id === 'other' ? 'modules' : id) as typeof settingsSection
      await settingsAdapter.update({ ui: { activeSection: currentSettingsSection } })
    },
    async open(id) {
      if (!['archive', 'modules', 'sounds', 'analytics', 'other', 'triggers', 'remote'].includes(id))
        return
      currentSettingsSection = (id === 'other' ? 'modules' : id) as typeof settingsSection
      await settingsAdapter.update({ ui: { activeSection: currentSettingsSection } })
      reveal('chatgpt-booster', 'settings')
    },
  },
  quickActions: [
    {
      id: 'settings',
      label: 'Настройки',
      labelEn: 'Settings',
      icon: 'settings',
      availableWhenDisabled: true,
      run: () => reveal('chatgpt-booster', 'settings'),
    },
    {
      id: 'archive',
      label: 'Открыть архив',
      labelEn: 'Open archive',
      icon: 'archive',
      run: () => reveal('chatgpt-booster', 'archive'),
    },
    {
      id: 'collect',
      label: 'Собрать историю',
      labelEn: 'Collect history',
      icon: 'collect',
      run: () => reveal('chatgpt-booster', 'collect'),
    },
    {
      id: 'export',
      label: 'Экспорт сохранённого чата',
      labelEn: 'Export saved conversation',
      icon: 'export',
      run: () => reveal('chatgpt-booster', 'export'),
    },
  ],
  async quickMetrics() {
    const n = c.getCount()
    return [
      { label: 'Сохранено сообщений', labelEn: 'Saved messages', value: n },
      { label: 'Внутренних элементов', labelEn: 'Internal elements', value: n * 3 },
      { label: 'Вызовов инструментов', labelEn: 'Tool calls', value: n * 2 },
      { label: 'Reasoning', value: n },
    ]
  },
  targets: ['userscript', 'chromium'],
  requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
  match: (url) => url.hostname === 'chatgpt.com',
  start() {
    if (new URLSearchParams(location.search).get('wsFixture') === '1')
      automationFixture = createLabAutomation(settingsAdapter, productId)
    chatGptViewContext.value = {
      archiveAdapter: c.adapter,
      fixedArchive: c.fixedArchive,
      settingsAdapter,
      automationControl: automationFixture?.control,
      diagnosticsAdapter: transport,
      targetLabel: installLabel,
      persistentDiagnosticsAdapter: {
        async getLifetimeTransportCounters() {
          return transport.getTransportCounters()
        },
        async recordTransport() {},
        subscribeLifetimeTransport: transport.subscribeTransport,
      },
      secretAdapter: automationFixture?.secrets ?? {
        async getTelemetryToken() {
          return ''
        },
        async setTelemetryToken() {},
      },
      telemetryControlAdapter: {
        async test() {
          throw Error('Network telemetry is disabled in UI Acceptance Lab')
        },
      },
    }
  },
  stop() {
    automationFixture?.close()
    automationFixture = undefined
    chatGptViewContext.value = null
  },
  open: () => reveal('chatgpt-booster', 'settings'),
}

const vkFeature: Feature = {
  id: 'vk-booster',
  title: 'VK Booster',
  description: 'Инструменты VK для текущей страницы',
  descriptionEn: 'VK tools for the current page',
  presentation: { panel: 'standard', version: '1.0.0', installation: installLabel },
  launcher: { mode: 'quick-menu' },
  settings: {
    categories: [
      { id: 'capture', title: 'Выгрузка', titleEn: 'Capture' },
      { id: 'reader', title: 'Архив', titleEn: 'Archive' },
      { id: 'settings', title: 'Параметры', titleEn: 'Parameters' },
    ],
    currentCategory: () => vkActiveView.value,
    subscribe: (listener) => watch(vkActiveView, listener),
    restoreCategory(categoryId) {
      if (categoryId === 'capture' || categoryId === 'reader' || categoryId === 'settings')
        vkActiveView.value = categoryId
    },
    open: (categoryId) => {
      if (categoryId === 'capture' || categoryId === 'reader' || categoryId === 'settings')
        reveal('vk-booster', categoryId)
    },
  },
  quickActions: [
    {
      id: 'settings',
      label: 'Настройки',
      labelEn: 'Settings',
      icon: 'settings',
      availableWhenDisabled: true,
      run: () => reveal('vk-booster', 'settings'),
    },
    {
      id: 'archive',
      label: 'Открыть архив',
      labelEn: 'Open archive',
      icon: 'archive',
      visible: () => inConversation,
      run: () => reveal('vk-booster', 'reader'),
    },
    {
      id: 'collect',
      label: 'Собрать диалог',
      labelEn: 'Collect conversation',
      icon: 'collect',
      visible: () => inConversation,
      run: () => reveal('vk-booster', 'collect'),
    },
    {
      id: 'export',
      label: 'Экспорт сохранённого чата',
      labelEn: 'Export saved conversation',
      icon: 'export',
      visible: () => inConversation,
      run: () => reveal('vk-booster', 'export'),
    },
  ],
  async quickMetrics() {
    if (!inConversation) return []
    return [
      { label: 'Сохранено сообщений', labelEn: 'Saved messages', value: vk.api.status().messages },
      {
        label: 'Новых за запуск',
        labelEn: 'New this run',
        value: vk.api.status().progress.newCount ?? 0,
      },
    ]
  },
  targets: ['userscript', 'chromium'],
  requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
  match: (url) => /^(vk\.com|vk\.ru)$/.test(url.hostname),
  start() {},
  stop() {},
  subscribeQuickContext: (listener) => vk.api.subscribe(() => listener()),
  open: () => reveal('vk-booster', 'settings'),
}

const features = scene.product.startsWith('all-in-one')
  ? [chatgpt, vkFeature]
  : vkHost
    ? [vkFeature]
    : [chatgpt]
const productId = scene.product.startsWith('all-in-one')
  ? 'all-in-one'
  : vkHost
    ? 'vk-booster'
    : 'chatgpt-booster'
const applicationManifest =
  productId === 'all-in-one' ? aggregateManifest : vkHost ? vkManifest : chatgptManifest
const telemetry = createLabTelemetry(target, settingsStore, productId)
const runtime = new FeatureRuntime(
  features,
  {
    target,
    url: hostUrl,
    capabilities: new Set(['page-dom', 'origin-storage', 'local-files']),
    settings: new FeatureSettings(settingsStore),
  },
  createRuntimeTelemetry(telemetry),
)
const site = document.getElementById('site')
if (!site) throw Error('UI Lab preview mount not found')
mountDemoSite(site, { vk: vkHost, inConversation, aggregate: scene.product.startsWith('all-in-one') })

/** Read-only layout checks; reported to the parent without mounting extra UI in Shadow DOM. */
let presentationReady = false
function diagnose() {
  const shadow = document.getElementById(shellInstanceKey('koba-browser-tools-root'))?.shadowRoot
  const modal = shadow?.querySelector<HTMLElement>('.booster-modal-surface')
  const quick = shadow?.querySelector<HTMLElement>('.booster-quick-menu')
  const productGrid = shadow?.querySelector<HTMLElement>(
    '.booster-control-embedded > .booster-settings-layout',
  )
  const root = shadow?.querySelector<HTMLElement>('.booster-overlay-root')
  const gridDisplay = productGrid ? getComputedStyle(productGrid).display : null
  const warnings: string[] = [...browserErrors]
  if (site?.hasAttribute('data-lab-error')) warnings.push('Failed to start synthetic runtime')
  if (matrixId) {
    if (scene.view === 'quick' && (!quick || modal))
      warnings.push('Expected compact quick menu, no full modal')
    if ((scene.view === 'archive' || scene.view === 'settings') && !modal)
      warnings.push('Expected full module panel')
    if ((scene.view === 'archive' || scene.view === 'settings') && modal) {
      if (innerWidth <= 620) {
        const box = modal.getBoundingClientRect()
        if (
          !modal.classList.contains('booster-modal-fullscreen') ||
          Math.abs(box.left) > 1 ||
          Math.abs(box.top) > 1 ||
          Math.abs(box.width - innerWidth) > 1 ||
          Math.abs(box.height - innerHeight) > 1
        )
          warnings.push('Mobile panel must fill the entire viewport')
        if (modal.querySelector('.booster-floating-chrome, .booster-floating-resize'))
          warnings.push('Mobile panel contains desktop window controls')
      } else {
        if (!modal.classList.contains('booster-dialog-floating'))
          warnings.push('Selected single-host panel is not floating')
        if (!modal.querySelector('.booster-floating-resize'))
          warnings.push('Floating panel has no resize handle')
      }
    }
    if (scene.view === 'closed' && (modal || quick))
      warnings.push('Closed launcher unexpectedly opened a surface')
    if (!modal && !shadow?.querySelector('.booster-launcher')) warnings.push('Docked launcher absent')
    if (
      modal &&
      shadow?.querySelector('.booster-launcher') &&
      shadow?.querySelector('.booster-control-standalone')
    )
      warnings.push('Docked launcher overlays active standalone modal')
    if (scene.view === 'quick' && quick) {
      if (
        !quick.querySelector('.booster-quick-identity')?.textContent?.includes(applicationManifest.name)
      )
        warnings.push('Quick menu title mismatch')
      if (!quick.querySelector('[role="switch"]')) warnings.push('Installation switch missing')
      if (quick.scrollHeight > quick.clientHeight + 3)
        warnings.push('Quick menu requires internal scrolling')
    }
    if (scene.view === 'settings' && !vkHost && scene.scene !== 'disabled' && !productGrid)
      warnings.push('ChatGPT nested settings grid not mounted')
    if (scene.product.startsWith('all-in-one') && scene.view === 'settings') {
      const sharedNav = shadow ? findPlatformSettingsNav(shadow) : null
      if (sharedNav) warnings.push('Duplicate platform navigation in single-host aggregate')
    }
    const launcher = shadow?.querySelector<HTMLElement>('.booster-launcher')
    if (launcher) {
      const box = launcher.getBoundingClientRect()
      if (scene.side === 'left' && box.left > 13) warnings.push('Launcher did not dock left')
      if (scene.side === 'right' && innerWidth - box.right > 13)
        warnings.push('Launcher did not dock right')
    }
    if (quick) {
      const badges = quick.querySelector('.booster-quick-identity')?.textContent || ''
      if (!badges.includes(applicationManifest.version)) warnings.push('Version badge missing')
      if (
        scene.scene === 'empty' &&
        quick.textContent?.includes('Сохранено сообщений') &&
        !quick.textContent.includes('0')
      )
        warnings.push('Empty archive shows nonzero metrics')
    }
    if (document.documentElement.scrollWidth > innerWidth + 3) warnings.push('Horizontal page overflow')
  }
  if (!root) warnings.push('Shell не смонтирован')
  for (const [name, el] of [
    ['Окно', modal],
    ['Быстрое меню', quick],
  ] as const) {
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (rect.left < -2 || rect.right > innerWidth + 2 || rect.top < -2 || rect.bottom > innerHeight + 2)
      warnings.push(`${name}: выходит за границы viewport`)
  }
  if (scene.view === 'settings' && !vkHost && scene.scene !== 'disabled' && productGrid) {
    const navigation = shadow?.querySelector<HTMLElement>(
      '.booster-control-standalone > .settings-catalog',
    )
    const content = productGrid.querySelector<HTMLElement>(':scope > .booster-settings-content')
    if (!navigation || !content) warnings.push('Settings navigation or content missing')
    else
      warnings.push(
        ...settingsNavigationWarnings({
          viewportWidth: innerWidth,
          columns:
            gridDisplay === 'grid'
              ? getComputedStyle(productGrid).gridTemplateColumns.trim().split(/\s+/).length
              : 1,
          navigation: navigation.getBoundingClientRect(),
          content: content.getBoundingClientRect(),
        }),
      )
  }
  if (matrixId && scene.view !== 'closed' && !modal && !quick) warnings.push('Панель не открылась')
  const data = {
    shellPreferences: runtime.shellPreferences(),
    presentation: presentationReady
      ? {
          surface: modal ? 'panel' : quick ? 'quick' : 'closed',
          view: (() => {
            if (shadow?.querySelector('[data-shell-settings]')) return 'shell-settings'
            const current = shadow
              ?.querySelector('[data-provider-view]')
              ?.getAttribute('data-provider-view')
            return current === 'settings' ? 'settings' : current === 'capture' ? 'capture' : 'archive'
          })(),
          section:
            shadow?.querySelector('[data-settings-section]')?.getAttribute('data-settings-section') ??
            'modules',
          category:
            shadow?.querySelector('[data-settings-category]')?.getAttribute('data-settings-category') ??
            shadow?.querySelector('[data-shell-category]')?.getAttribute('data-shell-category') ??
            'interface',
        }
      : undefined,
    product: scene.product,
    scene: scene.scene,
    view: scene.view,
    method: scene.method,
    side: scene.side,
    viewport: `${innerWidth}×${innerHeight}`,
    width: innerWidth,
    height: innerHeight,
    shell: Boolean(root),
    modal: Boolean(modal),
    quick: Boolean(quick),
    gridDisplay,
    warnings,
  }
  ;(window as Window & { __uiLabPreviewReport?: unknown }).__uiLabPreviewReport = data
  // Matrix sends exactly one final result per iframe. Avoid flooding the parent
  // (and remote browser automation) with intermediate mutation diagnostics.
  if (!matrixId)
    window.parent.postMessage(
      {
        type: 'koba:ui-lab:diagnostics',
        context: location.search,
        caseId: null,
        phase: 'intermediate',
        data,
      },
      location.origin,
    )
  return data
}

async function checkInteractions(): Promise<string[]> {
  const warnings: string[] = []
  const root = document.getElementById(shellInstanceKey('koba-browser-tools-root'))?.shadowRoot
  if (!root) return ['Cannot click missing Shell']
  const query = (selector: string) => root.querySelector<HTMLElement>(selector)
  if (scene.view === 'quick') {
    const menu = query('.booster-quick-menu')
    const first = menu?.querySelector<HTMLButtonElement>('.booster-quick-actions > button')
    if (!first) return ['Quick menu has no executable actions']
    if (scene.scene === 'disabled') {
      if (
        !Array.from(
          menu?.querySelectorAll<HTMLButtonElement>(
            '[data-quick-action="collect"],[data-quick-action="export"]',
          ) ?? [],
        ).every((button) => button.disabled)
      )
        warnings.push('Disabled installation exposes enabled capture/export action')
      if (first.disabled) warnings.push('Disabled installation blocks settings access')
      const toggle = menu?.querySelector<HTMLButtonElement>('[role="switch"]')
      toggle?.click()
      await sleep(80)
      if (!query('.booster-quick-menu')) warnings.push('Menu lost after reactivating installation')
    }
    first.click()
    await sleep(300)
    if (!query('.booster-modal-surface')) warnings.push('Quick action did not open the full panel')
    const close = query(
      '.booster-modal-surface button[aria-label="Закрыть окно"],.booster-modal-surface .booster-control-header button[title="Закрыть"]',
    )
    close?.click()
    await sleep(220)
  } else if (scene.view === 'closed') {
    const launcher = query('.booster-launcher') as HTMLButtonElement | null
    launcher?.click()
    await sleep(20)
    if (!query('.booster-quick-menu')) warnings.push('Launcher click did not open the quick menu')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await sleep(20)
    if (query('.booster-quick-menu')) warnings.push('Escape did not close quick menu')
  } else if (scene.view === 'settings') {
    if (!vkHost && scene.scene !== 'disabled') {
      const nav = query('.booster-control-standalone > .settings-catalog')
      const mobileToggle = nav?.querySelector<HTMLButtonElement>('[data-settings-catalog-toggle]')
      if (innerWidth <= 620) {
        if (!mobileToggle) warnings.push('Mobile settings catalog has no expand control')
        else {
          mobileToggle.click()
          await sleep(30)
          mobileToggle.click()
          await sleep(30)
        }
      } else if (!nav?.querySelector('[role="tab"]')) warnings.push('Shared settings catalog is missing')
    }
  } else if (scene.view === 'archive' && scene.scene === 'saved') {
    const capture = query('.booster-conversation-collection button') as HTMLButtonElement | null
    if (capture && !capture.disabled) {
      capture.click()
      await sleep(490)
      if (query('.booster-error,[role="alert"]')?.textContent?.includes('не выполнен'))
        warnings.push('Synthetic capture did not finish')
    }
  }
  return warnings
}

void runtime
  .start()
  .then(() => {
    // Product/channel keys are isolated by the http:// local preview origin.
    if (!resume || new URLSearchParams(location.search).get('dockReset') === '1')
      localStorage.setItem(
        shellInstanceKey('koba-browser:edge-launcher'),
        JSON.stringify({
          side: scene.side,
          ratio: (() => {
            const ratio = Number(new URLSearchParams(location.search).get('dockRatio') ?? '0.4')
            return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : 0.4
          })(),
        }),
      )
    // The Lab URL owns presentation; stale tab UI must not reopen a closed scenario.
    sessionStorage.removeItem(shellInstanceKey('koba-browser:session-ui'))
    // Mount the actual Shell exactly once; fixture methods never invoke provider APIs.
    const ui = mountControlCenter({
      runtime,
      telemetry,
      backup: createLabBackup(stored, settingsAdapter, productId, () => runtime.refreshFromSettings()),
      application: {
        id: productId,
        title: applicationManifest.name,
        version: applicationManifest.version,
        installation: installLabel,
        components:
          productId === 'all-in-one'
            ? [
                { id: 'chatgpt-booster', title: chatgptManifest.name, version: chatgptManifest.version },
                { id: 'vk-booster', title: vkManifest.name, version: vkManifest.version },
              ]
            : undefined,
      },
      title: vkHost ? 'VK Booster' : 'ChatGPT Booster',
      launcher: true,
      views: vkHost ? { 'vk-booster': ArchivePanel } : { 'chatgpt-booster': ChatGptPanel },
    })
    const onLabCommand = (event: MessageEvent) => {
      if (
        event.origin !== location.origin ||
        event.source !== window.parent ||
        event.data?.type !== 'koba:ui-lab:command'
      )
        return
      if (event.data.action === 'settings') ui.openSettings()
      if (event.data.action === 'menu') ui.openMenu()
    }
    window.addEventListener('message', onLabCommand)
    let pending = false
    const scheduleDiagnostics = () => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        diagnose()
      })
    }
    const root = document.getElementById(shellInstanceKey('koba-browser-tools-root'))?.shadowRoot
    const observer = new MutationObserver(scheduleDiagnostics)
    if (root)
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'class',
          'style',
          'data-provider-view',
          'data-settings-section',
          'data-shell-category',
          'data-settings-category',
        ],
      })
    root?.addEventListener('animationend', scheduleDiagnostics)
    root?.addEventListener('transitionend', scheduleDiagnostics)
    window.addEventListener('resize', scheduleDiagnostics)
    requestAnimationFrame(() => {
      const initial = ['closed', 'quick', 'settings', 'archive', 'capture', 'shell-settings'].includes(
        resume ?? '',
      )
        ? resume
        : scene.view
      if (initial === 'quick') {
        root?.querySelector<HTMLButtonElement>('.booster-launcher')?.click()
      } else if (
        initial === 'shell-settings' ||
        (initial === 'settings' && new URLSearchParams(location.search).get('task') === 'interface')
      ) {
        ui.openSettings(
          readLabSettingsCategory(new URLSearchParams(location.search).get('shellCategory')),
        )
      } else if (initial !== 'closed') {
        reveal(
          vkHost ? 'vk-booster' : 'chatgpt-booster',
          vkHost && !inConversation
            ? 'settings'
            : initial === 'capture'
              ? 'capture'
              : initial === 'settings'
                ? vkHost && requestedSection === 'capture'
                  ? 'capture'
                  : 'settings'
                : vkHost
                  ? 'reader'
                  : 'archive',
        )
      }
      presentationReady = true
      scheduleDiagnostics()
    })
    if (matrixId) {
      setTimeout(() => {
        void (async () => {
          // Wait for the actual surface to settle, rather than sampling its
          // short Dialog entrance transform as a permanent geometry failure.
          const settledUntil = Date.now() + 1500
          let previous = '',
            stableFrames = 0
          while (Date.now() < settledUntil && stableFrames < 3) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            const surface = root?.querySelector<HTMLElement>(
              '.booster-modal-surface,.booster-quick-menu',
            )
            const box = surface?.getBoundingClientRect()
            const signature = box
              ? [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 10)).join(':')
              : 'closed'
            stableFrames = signature === previous ? stableFrames + 1 : 0
            previous = signature
          }
          const before = diagnose()
          const checks = runInteractions ? await checkInteractions() : []
          const after = diagnose()
          const warnings = [
            ...new Set([
              ...before.warnings,
              ...after.warnings.filter(
                (issue) =>
                  ![
                    'Expected compact quick menu, no full modal',
                    'Closed launcher unexpectedly opened a surface',
                    'Expected full module panel',
                    'Панель не открылась',
                  ].includes(issue),
              ),
              ...checks,
            ]),
          ]
          window.parent.postMessage(
            {
              type: 'koba:ui-lab:diagnostics',
              context: location.search,
              caseId: matrixId,
              phase: 'final',
              data: { ...before, warnings },
            },
            location.origin,
          )
        })()
      }, 240)
    }
    window.addEventListener(
      'pagehide',
      () => {
        observer.disconnect()
        window.removeEventListener('resize', scheduleDiagnostics)
        ui.destroy()
        telemetry.close()
        automationFixture?.close()
        window.removeEventListener('message', onLabCommand)
        vk.dispose()
        chatGptViewContext.value = null
      },
      { once: true },
    )
  })
  .catch(() => {
    site?.setAttribute('data-lab-error', 'true')
  })
