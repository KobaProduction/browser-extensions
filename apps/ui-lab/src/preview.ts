/** Browser-only isolated synthetic preview; imports the actual Shell and provider Vue views. */
import {
  type Feature,
  FeatureRuntime,
  FeatureSettings,
  instanceKey,
  type SettingsStore,
  SHELL_OPEN_FEATURE_EVENT,
} from '@kobaproduction/browser-core'
import ChatGptPanel from '../../../modules/chatgpt-booster/src/features/archive/ui/ChatGptPanel.vue'
import { chatGptRequestedSection, chatGptViewContext } from '../../../modules/chatgpt-booster/src/index'
import { vkRequestedView } from '../../../modules/vk-booster/src/features/chat-export/model/ui-navigation'
import ArchivePanel from '../../../modules/vk-booster/src/features/chat-export/ui/ArchivePanel.vue'
import { mountControlCenter } from '../../../packages/shell/src/mount'
import {
  createMockChatGptArchive,
  createMockCounters,
  createMockSettingsAdapter,
  createMockVkArchive,
  fixtureSize,
} from './fixtures'
import { findPlatformSettingsNav, settingsNavigationWarnings } from './navigation-diagnostics'
import { readScenario } from './scenes'
import './preview.css'

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
const hostUrl = new URL(vkHost ? 'https://vk.com/im?sel=9001' : 'https://chatgpt.com/c/demo-dialog')
const target = scene.method === 'tampermonkey' ? ('userscript' as const) : ('chromium' as const)
const installLabel = scene.method === 'tampermonkey' ? 'Tampermonkey' : 'Chromium MV3'
const c = createMockChatGptArchive(scene.scene)
const vk = createMockVkArchive(scene.scene, scene.method)
const settingsAdapter = createMockSettingsAdapter()
const transport = createMockCounters(fixtureSize(scene.scene))
const stored = new Map<string, boolean>()
if (scene.scene === 'disabled') stored.set('installation.enabled', false)
const settingsStore: SettingsStore = {
  async get(key) {
    return stored.get(key)
  },
  async set(key, value) {
    stored.set(key, value)
  },
}

function reveal(id: string, section?: string) {
  if (id === 'chatgpt-booster')
    chatGptRequestedSection.value = (section || 'archive') as typeof chatGptRequestedSection.value
  if (id === 'vk-booster')
    vkRequestedView.value = (
      section === 'archive' ? 'reader' : section || 'capture'
    ) as typeof vkRequestedView.value
  window.dispatchEvent(new CustomEvent(SHELL_OPEN_FEATURE_EVENT, { detail: { id } }))
}

const chatgpt: Feature = {
  id: 'chatgpt-booster',
  title: 'ChatGPT Booster',
  description: 'DEMO: история, оригинальные метаданные и аналитика',
  presentation: { panel: 'wide', version: '2.0.19', installation: installLabel },
  launcher: { mode: 'quick-menu' },
  quickActions: [
    {
      id: 'settings',
      label: 'Настройки',
      icon: 'settings',
      run: () => reveal('chatgpt-booster', 'settings'),
    },
    {
      id: 'archive',
      label: 'Открыть архив',
      icon: 'archive',
      run: () => reveal('chatgpt-booster', 'archive'),
    },
    {
      id: 'collect',
      label: 'Собрать историю',
      icon: 'collect',
      run: () => reveal('chatgpt-booster', 'collect'),
    },
    {
      id: 'export',
      label: 'Экспорт сохранённого чата',
      icon: 'export',
      run: () => reveal('chatgpt-booster', 'export'),
    },
  ],
  async quickMetrics() {
    const n = c.getCount()
    return [
      { label: 'Сохранено сообщений', value: n },
      { label: 'Внутренних элементов', value: n * 3 },
      { label: 'Вызовов инструментов', value: n * 2 },
      { label: 'Reasoning', value: n },
    ]
  },
  targets: ['userscript', 'chromium'],
  requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
  match: (url) => url.hostname === 'chatgpt.com',
  start() {
    chatGptViewContext.value = {
      archiveAdapter: c.adapter,
      fixedArchive: c.fixedArchive,
      settingsAdapter,
      diagnosticsAdapter: transport,
      targetLabel: installLabel,
      persistentDiagnosticsAdapter: {
        async getLifetimeTransportCounters() {
          return transport.getTransportCounters()
        },
        async recordTransport() {},
        subscribeLifetimeTransport: transport.subscribeTransport,
      },
      secretAdapter: {
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
    chatGptViewContext.value = null
  },
  open: () => reveal('chatgpt-booster', 'settings'),
}

const vkFeature: Feature = {
  id: 'vk-booster',
  title: 'VK Booster',
  description: 'DEMO: VK-переписки, архив и экспорт',
  presentation: { panel: 'standard', version: '1.0.0', installation: installLabel },
  launcher: { mode: 'quick-menu' },
  quickActions: [
    {
      id: 'settings',
      label: 'Настройки',
      icon: 'settings',
      run: () => reveal('vk-booster', 'settings'),
    },
    {
      id: 'archive',
      label: 'Открыть архив',
      icon: 'archive',
      run: () => reveal('vk-booster', 'reader'),
    },
    {
      id: 'collect',
      label: 'Собрать диалог',
      icon: 'collect',
      run: () => reveal('vk-booster', 'collect'),
    },
    {
      id: 'export',
      label: 'Экспорт сохранённого чата',
      icon: 'export',
      run: () => reveal('vk-booster', 'export'),
    },
  ],
  async quickMetrics() {
    return [
      { label: 'Сохранено сообщений', value: vk.api.status().messages },
      { label: 'Новых за запуск', value: vk.api.status().progress.newCount ?? 0 },
    ]
  },
  targets: ['userscript', 'chromium'],
  requiredCapabilities: ['page-dom', 'origin-storage', 'local-files'],
  match: (url) => /^(vk\.com|vk\.ru)$/.test(url.hostname),
  start() {},
  stop() {},
  open: () => reveal('vk-booster', 'reader'),
}

const features = scene.product.startsWith('all-in-one')
  ? [chatgpt, vkFeature]
  : vkHost
    ? [vkFeature]
    : [chatgpt]
const runtime = new FeatureRuntime(features, {
  target,
  url: hostUrl,
  capabilities: new Set(['page-dom', 'origin-storage', 'local-files']),
  settings: new FeatureSettings(settingsStore),
})
const site = document.getElementById('site')
if (!site) throw Error('UI Lab preview mount not found')
site.innerHTML =
  '<div class="demo-banner">СИНТЕТИЧЕСКИЙ САЙТ · <b>Тестирование интерфейса без подключения к реальным сервисам</b></div><div class="demo-chrome"><span class="demo-dot"></span><span class="demo-address"></span></div><main class="demo-main"><div class="demo-pill">DEMO HOST</div><h1>Conversation workspace</h1><p>Только синтетический контент. Никакие данные аккаунта не загружены.</p><article><b>DEMO:</b> Проверка наложения окна расширения на интерфейс сайта.<p>Переключай размеры в панели тестов, проверь меню, вложенность, прокрутку и состояния.</p></article></main>'
const addressLabel = site.querySelector('.demo-address')
if (addressLabel) addressLabel.textContent = hostUrl.hostname + hostUrl.pathname

/** Read-only layout checks; reported to the parent without mounting extra UI in Shadow DOM. */
function diagnose() {
  const shadow = document.getElementById(instanceKey('koba-browser-tools-root'))?.shadowRoot
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
      if (!modal.classList.contains('booster-dialog-floating'))
        warnings.push('Selected single-host panel is not floating')
      if (!modal.querySelector('.booster-floating-resize'))
        warnings.push('Floating panel has no resize handle')
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
      if (!quick.textContent?.includes(vkHost ? 'VK Booster' : 'ChatGPT Booster'))
        warnings.push('Quick menu title mismatch')
      if (!quick.textContent?.includes(installLabel))
        warnings.push('Installation method missing from quick menu')
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
      const badges = quick.querySelector('.booster-quick-badges')?.textContent || ''
      if (!badges.match(/2\.0\.19|1\.0\.0/)) warnings.push('Version badge missing')
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
  if (
    scene.view === 'settings' &&
    !vkHost &&
    scene.scene !== 'disabled' &&
    productGrid &&
    gridDisplay !== 'grid'
  )
    warnings.push('Навигация настроек потеряла двухколоночную сетку')
  if (scene.view === 'settings' && !vkHost && scene.scene !== 'disabled' && productGrid) {
    const navigation = productGrid.querySelector<HTMLElement>(':scope > .booster-settings-nav')
    const content = productGrid.querySelector<HTMLElement>(':scope > .booster-settings-content')
    if (!navigation || !content) warnings.push('Settings navigation or content missing')
    else
      warnings.push(
        ...settingsNavigationWarnings({
          viewportWidth: innerWidth,
          columns: getComputedStyle(productGrid).gridTemplateColumns.trim().split(/\s+/).length,
          navigation: navigation.getBoundingClientRect(),
          content: content.getBoundingClientRect(),
        }),
      )
  }
  if (scene.view !== 'closed' && !modal && !quick) warnings.push('Панель не открылась')
  const data = {
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
      { type: 'koba:ui-lab:diagnostics', caseId: null, phase: 'intermediate', data },
      location.origin,
    )
  return data
}

async function checkInteractions(): Promise<string[]> {
  const warnings: string[] = []
  const root = document.getElementById(instanceKey('koba-browser-tools-root'))?.shadowRoot
  if (!root) return ['Cannot click missing Shell']
  const query = (selector: string) => root.querySelector<HTMLElement>(selector)
  if (scene.view === 'quick') {
    const menu = query('.booster-quick-menu')
    const first = menu?.querySelector<HTMLButtonElement>('.booster-quick-actions > button')
    if (!first) return ['Quick menu has no executable actions']
    if (scene.scene === 'disabled') {
      if (!first.disabled) warnings.push('Disabled installation exposes enabled archive action')
      const toggle = menu?.querySelector<HTMLButtonElement>('[role="switch"]')
      toggle?.click()
      await sleep(80)
      if (!query('.booster-quick-menu')) warnings.push('Menu lost after reactivating installation')
    }
    first.click()
    await sleep(120)
    if (!query('.booster-modal-surface')) warnings.push('Quick action did not open the full panel')
    const close = query('.booster-modal-surface .booster-control-header button[title="Закрыть"]')
    close?.click()
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
      const nav = query('.booster-control-embedded .booster-settings-nav')
      const tabs = nav?.querySelectorAll('button')
      if (!tabs?.length || tabs.length < 4)
        warnings.push('Nested ChatGPT settings navigation incomplete')
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
    localStorage.setItem(
      instanceKey('koba-browser:edge-launcher'),
      JSON.stringify({ side: scene.side, ratio: 0.4 }),
    )
    // Mount the actual Shell exactly once; fixture methods never invoke provider APIs.
    const ui = mountControlCenter({
      runtime,
      title: vkHost ? 'VK Booster' : 'ChatGPT Booster',
      launcher: true,
      views: vkHost ? { 'vk-booster': ArchivePanel } : { 'chatgpt-booster': ChatGptPanel },
    })
    let pending = false
    const scheduleDiagnostics = () => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        diagnose()
      })
    }
    const root = document.getElementById(instanceKey('koba-browser-tools-root'))?.shadowRoot
    const observer = new MutationObserver(scheduleDiagnostics)
    if (root)
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
    window.addEventListener('resize', scheduleDiagnostics)
    requestAnimationFrame(() => {
      if (scene.view === 'quick') {
        root?.querySelector<HTMLButtonElement>('.booster-launcher')?.click()
      } else if (scene.view !== 'closed') {
        reveal(
          vkHost ? 'vk-booster' : 'chatgpt-booster',
          scene.view === 'settings' ? 'settings' : vkHost ? 'reader' : 'archive',
        )
      }
      scheduleDiagnostics()
    })
    if (matrixId) {
      setTimeout(() => {
        void (async () => {
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
        vk.dispose()
        chatGptViewContext.value = null
      },
      { once: true },
    )
  })
  .catch(() => {
    site?.setAttribute('data-lab-error', 'true')
  })
