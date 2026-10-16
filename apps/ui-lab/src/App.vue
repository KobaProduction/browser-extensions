<script setup lang="ts">
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
} from '@kobaproduction/browser-ui'
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  CheckCheck,
  ChevronRight,
  LayoutDashboard,
  Settings2,
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  areaFromHash,
  areaScenes,
  areaView,
  type LabArea,
  type LabInstallation,
  type LabSite,
  labAreas,
  previewProduct,
} from './explorer'
import LabSelect from './LabSelect.vue'
import {
  buildLabMatrix,
  type LabMatrixCase,
  type LabMatrixMode,
  type LabMatrixResult,
  matrixReport,
  viewportDimensions,
} from './matrix'
import { type LabPresentation, readLabPresentation } from './presentation'
import type { LabMethod, LabProduct, LabScene, LabView } from './scenes'

const area = ref<LabArea>(areaFromHash(location.hash))
const installation = ref<LabInstallation>('chatgpt')
const site = ref<LabSite>('chatgpt')
const page = ref<'conversation' | 'home'>('conversation')
const product = computed<LabProduct>(() => previewProduct(installation.value, site.value))
const surface = ref<LabView>('quick')
const section = ref('modules')
const vkSite = computed(() => product.value === 'vk' || product.value === 'all-in-one-vk')
watch(page, () => {
  if (vkSite.value && page.value === 'home') section.value = 'settings'
})
watch(product, () => {
  section.value = vkSite.value ? 'settings' : 'modules'
})
const areaInfo = computed(() => labAreas.find((item) => item.id === area.value))
const icons = { layout: LayoutDashboard, archive: Archive, settings: Settings2, check: CheckCheck }
const stage = ref<HTMLElement>()
const stageWidth = ref(1000)
const inspectorOpen = ref(true)
const advancedOpen = ref(false)
const diagnosticsOpen = ref(false)
function setInstallation(value: unknown) {
  if (['chatgpt', 'vk', 'all-in-one'].includes(String(value)))
    installation.value = value as LabInstallation
}
function setSize(value: unknown) {
  if (['desktop', 'tablet', 'mobile'].includes(String(value))) size.value = value as typeof size.value
}
let stageObserver: ResizeObserver | undefined
let stageFrame = 0
const scale = computed(() => Math.min(1, Math.max(0.1, stageWidth.value / frameSize.value[0])))
function navigate(next: LabArea) {
  if (matrixRunning.value) stopMatrix()
  area.value = next
  history.pushState(null, '', next === 'home' ? location.pathname : `#${next}`)
}
function restoreRoute() {
  area.value = areaFromHash(location.hash)
}
watch(area, () => {
  diagnostics.value = null
  scene.value = 'saved'
})
watch(stage, (element) => {
  stageObserver?.disconnect()
  if (!element) return
  stageObserver = new ResizeObserver(([entry]) => {
    if (!entry || Math.abs(entry.contentRect.width - stageWidth.value) < 0.5) return
    cancelAnimationFrame(stageFrame)
    stageFrame = requestAnimationFrame(() => {
      stageWidth.value = entry.contentRect.width
    })
  })
  stageObserver.observe(element)
})
const scene = ref<LabScene>('saved')
const view = computed<LabView>(() => areaView(area.value, surface.value))
const method = ref<LabMethod>('tampermonkey')
const side = ref<'left' | 'right'>('right')
const size = ref<'desktop' | 'tablet' | 'mobile'>('desktop')
const matrixCase = ref<LabMatrixCase | null>(null)
const matrixMode = ref<LabMatrixMode>('smoke')
const matrixRunning = ref(false)
const matrixResults = ref<LabMatrixResult[]>([])
const matrixTotal = ref(0)
let matrixStopped = false
let awaiting: { id: string; resolve: (value: readonly string[]) => void } | null = null
const matrixSummary = computed(() => ({
  passed: matrixResults.value.filter((x) => x.status === 'pass').length,
  failed: matrixResults.value.filter((x) => x.status === 'fail').length,
}))
const frameSize = computed(() =>
  matrixCase.value ? viewportDimensions[matrixCase.value.viewport] : viewportDimensions[size.value],
)
const params = computed(() =>
  new URLSearchParams({
    product: product.value,
    scene: scene.value,
    view: view.value,
    method: method.value,
    side: side.value,
    section: area.value === 'modules' ? section.value : 'modules',
    page: area.value === 'archive' || !vkSite.value ? 'conversation' : page.value,
    task: area.value,
    nonce: 'synthetic',
  }).toString(),
)
const previewUrl = ref('')
const livePresentation = ref<LabPresentation | null>(null)
const shellPreferencesByProduct = new Map<
  LabInstallation,
  { launcher: boolean; siteEntry: boolean; quickMenu: boolean; metrics: boolean }
>()
const frameUrl = computed(() => {
  if (!matrixCase.value) return previewUrl.value
  const row = matrixCase.value
  return `/preview.html?${new URLSearchParams({ product: row.product, scene: row.scene, view: row.view, method: row.method, side: row.side, matrix: row.id, probe: matrixMode.value === 'smoke' || (row.scene === 'saved' && matrixMode.value === 'extended') ? '1' : '0' }).toString()}`
})
watch(frameUrl, () => {
  diagnostics.value = null
})
const frame = ref<HTMLIFrameElement>()
const diagnostics = ref<{
  shell: boolean
  modal: boolean
  quick: boolean
  gridDisplay: string | null
  warnings: string[]
} | null>(null)
watch(
  params,
  (next, previous) => {
    const query = new URLSearchParams(next)
    const before = new URLSearchParams(previous)
    const contextChanged =
      before.get('product') !== query.get('product') || before.get('page') !== query.get('page')
    const sameTask =
      before.get('task') === query.get('task') &&
      before.get('view') === query.get('view') &&
      (contextChanged || before.get('section') === query.get('section'))
    const state = sameTask ? livePresentation.value : null
    const preferences = shellPreferencesByProduct.get(installation.value)
    if (preferences) {
      query.set('launcher', preferences.launcher ? 'on' : 'off')
      query.set('siteEntry', preferences.siteEntry ? 'on' : 'off')
      query.set('quickMenu', preferences.quickMenu ? 'on' : 'off')
      query.set('metrics', preferences.metrics ? 'on' : 'off')
    }
    if (before.get('side') !== query.get('side')) query.set('dockReset', '1')
    if (state) {
      query.set('resume', state.surface === 'panel' ? state.view : state.surface)
      query.set('settingsSection', state.section)
      if (state.category) query.set('shellCategory', state.category)
    } else livePresentation.value = null
    previewUrl.value = `/preview.html?${query}`
  },
  { immediate: true },
)
function onMessage(event: MessageEvent) {
  if (
    event.origin !== location.origin ||
    event.source !== frame.value?.contentWindow ||
    event.data?.type !== 'koba:ui-lab:diagnostics'
  )
    return
  if (event.data.context !== new URL(frameUrl.value, location.origin).search) return
  diagnostics.value = event.data.data
  if (!matrixRunning.value) {
    const preferences = event.data.data?.shellPreferences
    if (typeof preferences?.launcher === 'boolean' && typeof preferences?.siteEntry === 'boolean') {
      shellPreferencesByProduct.set(installation.value, {
        launcher: preferences.launcher,
        siteEntry: preferences.siteEntry,
        quickMenu: preferences.quickMenu !== false,
        metrics: preferences.metrics !== false,
      })
    }
    const state = readLabPresentation(event.data.data?.presentation)
    if (state) livePresentation.value = state
  }
  if (awaiting && event.data?.phase === 'final' && event.data.caseId === awaiting.id) {
    const pending = awaiting
    awaiting = null
    pending.resolve(event.data.data?.warnings || ['No diagnostic data'])
  }
}
async function runMatrix() {
  if (matrixRunning.value) return
  area.value = 'matrix'
  const cases = buildLabMatrix(matrixMode.value)
  matrixRunning.value = true
  matrixStopped = false
  matrixTotal.value = cases.length
  matrixResults.value = []
  const started = performance.now()
  for (const item of cases) {
    if (matrixStopped) break
    const began = performance.now()
    const warnings = await new Promise<readonly string[]>((resolve) => {
      let finished = false
      const done = (issues: readonly string[]) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        awaiting = null
        resolve(issues)
      }
      awaiting = { id: item.id, resolve: done }
      const timer = window.setTimeout(() => done(['Scenario timed out after 8 seconds']), 8000)
      matrixCase.value = item
    })
    matrixResults.value.push({
      id: item.id,
      status: warnings.length ? 'fail' : 'pass',
      warnings,
      elapsedMs: Math.round(performance.now() - began),
    })
    // Yield after each iframe teardown so Chromium can release the previous frame.
    await nextTick()
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
  matrixRunning.value = false
  matrixCase.value = null
  diagnostics.value = null
  // Non-secret synthetic results for browser automation and CI.
  ;(window as Window & { __uiLabMatrixReport?: unknown }).__uiLabMatrixReport = {
    ...matrixReport(matrixMode.value, cases, matrixResults.value),
    elapsedMs: Math.round(performance.now() - started),
    finished: true,
  }
  window.parent?.postMessage(
    {
      type: 'koba:ui-lab:matrix-finished',
      data: {
        ...matrixReport(matrixMode.value, cases, matrixResults.value),
        elapsedMs: Math.round(performance.now() - started),
      },
    },
    location.origin,
  )
}
function stopMatrix() {
  matrixStopped = true
  awaiting?.resolve(['Stopped by user'])
  awaiting = null
}
function downloadMatrixReport() {
  const source = JSON.stringify(
    matrixReport(matrixMode.value, buildLabMatrix(matrixMode.value), matrixResults.value),
    null,
    2,
  )
  const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `ui-matrix-${matrixMode.value}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
onMounted(() => {
  window.addEventListener('message', onMessage)
  window.addEventListener('popstate', restoreRoute)
  const autorun = new URLSearchParams(location.search).get('autorun')
  if (autorun === 'smoke' || autorun === 'extended' || autorun === 'full') {
    matrixMode.value = autorun
    setTimeout(() => void runMatrix(), 300)
  }
})
onBeforeUnmount(() => {
  stopMatrix()
  stageObserver?.disconnect()
  cancelAnimationFrame(stageFrame)
  window.removeEventListener('popstate', restoreRoute)
  window.removeEventListener('message', onMessage)
})
function reload() {
  shellPreferencesByProduct.delete(installation.value)
  livePresentation.value = null
  diagnostics.value = null
  previewUrl.value = `/preview.html?${params.value}&reset=${Date.now()}`
}
function openBrowserTools(action: 'settings' | 'menu') {
  frame.value?.contentWindow?.postMessage({ type: 'koba:ui-lab:command', action }, location.origin)
}
</script>
<template>
  <main class="lab">
    <header class="topbar">
      <Button variant="ghost" class="brand" @click="navigate('home')" aria-label="На карту проверок"><LayoutDashboard :size="20" /><span>UI Acceptance Lab<small>Koba Browser Tools</small></span></Button>
      <Badge variant="secondary">Локальная песочница</Badge>
    </header>
    <nav v-if="area !== 'home'" class="breadcrumbs" aria-label="Навигация">
      <Button variant="ghost" size="sm" @click="navigate('home')"><ArrowLeft :size="14" />Карта проверок</Button><ChevronRight :size="14" /><span aria-current="page">{{ areaInfo?.title }}</span>
    </nav>
    <template v-if="area === 'home'">
      <section class="welcome"><span class="eyebrow">Рабочая карта</span><h1>Что проверяем?</h1><p>Выберите направление. Продукт, экран и сценарий настраиваются внутри — только то, что нужно для текущей задачи.</p></section>
      <section class="direction-grid" aria-label="Направления проверки">
        <Card v-for="item in labAreas" :key="item.id" class="relative" :data-lab-direction="item.id">
          <CardHeader><component :is="icons[item.icon]" :size="23" /><CardTitle class="text-lg">{{ item.title }}</CardTitle><CardDescription>{{ item.description }}</CardDescription></CardHeader>
          <CardFooter><Button variant="outline" class="w-full justify-between after:absolute after:inset-0 after:rounded-xl" :aria-label="item.title" @click="navigate(item.id)">{{ item.detail }}<ArrowUpRight :size="16" /></Button></CardFooter>
        </Card>
      </section>
      <section class="getting-started"><h2>Как пользоваться</h2><ol><li><b>Выберите задачу</b><span>Интерфейс, архив или настройки конкретного модуля.</span></li><li><b>Задайте контекст</b><span>Отдельное расширение или All-in-one с выбором сайта, затем размер экрана.</span></li><li><b>Проверьте поведение</b><span>Нажимайте кнопки, меняйте настройки и переключайте подходящие сценарии.</span></li></ol></section>
      <p class="safety-note">Здесь используются тестовые данные. Реальные аккаунты, переписки и сетевые запросы не подключаются.</p>
    </template>
    <template v-else>
      <header class="section-heading"><div><h1>{{ areaInfo?.title }}</h1><p>{{ areaInfo?.description }}</p></div></header>
      <div v-if="area !== 'matrix'" class="workbench" :class="{ 'inspector-hidden': !inspectorOpen }">
        <Card v-if="inspectorOpen" class="inspector" role="complementary" aria-label="Настройка сценария">
          <section class="inspector-section space-y-4"><h2>1. Продукт</h2>
            <RadioGroup :model-value="installation" aria-label="Продукт" @update:model-value="setInstallation">
              <div v-for="item in [{id:'chatgpt',title:'ChatGPT Booster'},{id:'vk',title:'VK Booster'},{id:'all-in-one',title:'All-in-one'}]" :key="item.id" class="flex items-center gap-3"><RadioGroupItem :id="'lab-product-'+item.id" :value="item.id" /><Label :for="'lab-product-'+item.id">{{ item.title }}</Label></div>
            </RadioGroup>
            <LabSelect v-if="installation === 'all-in-one'" :model-value="site" label="Сайт для проверки" :options="[{value:'chatgpt',label:'ChatGPT · chatgpt.com'},{value:'vk',label:'VK · vk.com'}]" @update:model-value="site = $event as LabSite" />
            <LabSelect v-if="vkSite && area !== 'archive'" :model-value="page" label="Страница VK" :options="[{value:'conversation',label:'Открытый диалог'},{value:'home',label:'Лента / вне диалога'}]" @update:model-value="page = $event as 'conversation' | 'home'" />
          </section>
          <section class="inspector-section space-y-4"><h2>2. Экран</h2>
            <RadioGroup :model-value="size" aria-label="Размер экрана" @update:model-value="setSize">
              <div v-for="item in [{id:'desktop',title:'Компьютер',detail:'1365 × 780'},{id:'tablet',title:'Планшет',detail:'768 × 790'},{id:'mobile',title:'Телефон',detail:'390 × 780'}]" :key="item.id" class="flex items-center gap-3"><RadioGroupItem :id="'lab-size-'+item.id" :value="item.id" /><Label :for="'lab-size-'+item.id" class="flex flex-1 justify-between gap-2">{{ item.title }}<span class="text-xs text-muted-foreground">{{ item.detail }}</span></Label></div>
            </RadioGroup>
            <p class="field-help">{{ size === 'mobile' ? 'Панель на весь экран, без рамки, перемещения и изменения размера.' : size === 'tablet' ? 'Компактные строки и настройки.' : 'Карточки и расширенное размещение.' }}</p>
          </section>
          <section class="inspector-section space-y-4"><h2>3. {{ area === 'archive' ? 'Данные архива' : area === 'modules' ? 'Раздел настроек' : 'Элемент интерфейса' }}</h2>
            <LabSelect v-if="area === 'interface'" :model-value="surface" label="Показать" :options="[{value:'quick',label:'Быстрое меню'},{value:'settings',label:'Панель настроек'},{value:'closed',label:'Только боковую кнопку'}]" @update:model-value="surface = $event as LabView" />
            <LabSelect v-if="area === 'modules'" v-model="section" label="Раздел" :options="!vkSite ? [{value:'modules',label:'Модули'},{value:'archive',label:'Сохранение сообщений'},{value:'sounds',label:'Звуки'},{value:'triggers',label:'Триггеры'},{value:'remote',label:'Сервер и синхронизация'},{value:'analytics',label:'Аналитика'},{value:'other',label:'Прочие настройки'}] : [{value:'settings',label:'Настройки VK'},...(page === 'conversation' ? [{value:'capture',label:'Сбор переписки'}] : [])]" />
            <LabSelect :model-value="scene" :label="area === 'archive' ? 'Сценарий' : 'Состояние расширения'" :options="areaScenes(area).map(item=>({value:item.id,label:item.title}))" @update:model-value="scene = $event as LabScene" />
          </section>
          <Collapsible v-model:open="advancedOpen" class="inspector-section space-y-4">
            <CollapsibleTrigger as-child><Button variant="ghost" class="w-full justify-between">Дополнительные параметры<ChevronRight :size="14" :class="{ 'rotate-90': advancedOpen }" /></Button></CollapsibleTrigger>
            <CollapsibleContent class="space-y-4">
              <LabSelect :model-value="method" label="Способ установки" :options="[{value:'tampermonkey',label:'Tampermonkey'},{value:'chromium',label:'Расширение Chrome / Edge'}]" @update:model-value="method = $event as LabMethod" />
              <p class="field-help">Проверяет подпись и доступные возможности способа установки.</p>
              <LabSelect :model-value="side" label="Сторона боковой кнопки" :options="[{value:'right',label:'Справа'},{value:'left',label:'Слева'}]" @update:model-value="side = $event as 'left' | 'right'" />
            </CollapsibleContent>
          </Collapsible>
        </Card>
        <section class="preview-workspace" aria-label="Предпросмотр сценария">
          <div class="preview-toolbar">
            <Button variant="outline" size="sm" @click="inspectorOpen = !inspectorOpen" :aria-expanded="inspectorOpen">{{ inspectorOpen ? 'Скрыть параметры' : 'Параметры' }}</Button>
            <span>{{ frameSize[0] }} × {{ frameSize[1] }} · {{ Math.round(scale * 100) }}%</span>
            <Button variant="outline" size="sm" title="Вход через Browser Tools" @click="openBrowserTools('settings')">Настройки приложения</Button>
            <Button variant="outline" size="sm" title="Вход через Browser Tools" @click="openBrowserTools('menu')">Показать меню</Button>
            <Button variant="ghost" size="sm" as-child><a :href="frameUrl" target="_blank" rel="noopener">Открыть отдельно<ArrowUpRight :size="14" /></a></Button>
            <Button variant="ghost" size="sm" @click="reload">Сбросить</Button>
          </div>
          <div ref="stage" class="stage"><div class="frame-fit" :style="{width:frameSize[0]*scale+'px',height:frameSize[1]*scale+'px'}"><iframe ref="frame" :src="frameUrl" title="Предпросмотр расширения — тестовые данные" :style="{width:frameSize[0]+'px',height:frameSize[1]+'px',transform:'scale('+scale+')'}" /></div></div>
          <Collapsible v-model:open="diagnosticsOpen" class="diagnostics" :class="{ bad: diagnostics?.warnings.length }">
            <CollapsibleTrigger as-child><Button variant="ghost" size="sm" class="w-full justify-start whitespace-normal text-left">{{ diagnostics ? diagnostics.warnings.length ? 'Замечания геометрии (' + diagnostics.warnings.length + ')' : 'Явного выхода за границы не обнаружено' : 'Ожидаем предпросмотр…' }}</Button></CollapsibleTrigger>
            <CollapsibleContent><p>Диагностика геометрии не подтверждает визуальную приёмку.</p><p v-for="warning in diagnostics?.warnings ?? []" :key="warning">{{ warning }}</p></CollapsibleContent>
          </Collapsible>
        </section>
      </div>
      <section v-else class="matrix-panel" aria-label="Автоматическая UI-матрица">
        <div class="matrix-toolbar">
          <LabSelect :model-value="matrixMode" label="Набор проверок" :disabled="matrixRunning" :options="[{value:'smoke',label:'Быстрая проверка · 96 сценариев'},{value:'extended',label:'Все размеры экрана · 288 сценариев'},{value:'full',label:'Полная матрица · 1152 сценария'}]" @update:model-value="matrixMode = $event as LabMatrixMode" />
          <Button :disabled="matrixRunning" @click="runMatrix">Запустить проверки</Button><Button v-if="matrixRunning" variant="outline" @click="stopMatrix">Остановить</Button><Button v-if="matrixResults.length && !matrixRunning" variant="outline" @click="downloadMatrixReport">Скачать отчёт</Button>
        </div>
        <output class="matrix-progress" role="status" aria-live="off" data-testid="matrix-progress">{{ matrixResults.length }} / {{ matrixTotal || buildLabMatrix(matrixMode).length }} · PASS {{ matrixSummary.passed }} · FAIL {{ matrixSummary.failed }}<span v-if="matrixRunning"> · {{ matrixCase?.id }}</span></output>
        <Progress v-if="matrixTotal" :model-value="matrixTotal ? matrixResults.length/matrixTotal*100 : 0" aria-label="Ход проверок" />
        <div v-if="matrixResults.some(x => x.status === 'fail')" class="matrix-failures"><p v-for="row in matrixResults.filter(x => x.status === 'fail')" :key="row.id">{{ row.id }} — {{ row.warnings.join('; ') }}</p></div>
        <p v-if="!matrixRunning && !matrixResults.length" class="matrix-empty">Проверки ещё не запускались. Каждый сценарий проверит интерфейс внутри отдельного тестового экрана.</p>
        <div v-if="matrixCase" class="matrix-stage"><iframe ref="frame" :src="frameUrl" title="Автоматическая проверка сценария" :style="{width:frameSize[0]+'px',height:frameSize[1]+'px'}" /></div>
      </section>
    </template>
  </main>
</template>
