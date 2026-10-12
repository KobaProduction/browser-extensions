<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  buildLabMatrix,
  type LabMatrixCase,
  type LabMatrixMode,
  type LabMatrixResult,
  matrixReport,
  viewportDimensions,
} from './matrix'
import type { LabMethod, LabProduct, LabScene, LabView } from './scenes'

const product = ref<LabProduct>('chatgpt')
const scene = ref<LabScene>('saved')
const view = ref<LabView>('settings')
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
    nonce: 'synthetic',
  }).toString(),
)
const frameUrl = computed(() => {
  if (!matrixCase.value) return `/preview.html?${params.value}`
  const row = matrixCase.value
  return `/preview.html?${new URLSearchParams({ product: row.product, scene: row.scene, view: row.view, method: row.method, side: row.side, matrix: row.id, probe: matrixMode.value === 'smoke' || (row.scene === 'saved' && matrixMode.value === 'extended') ? '1' : '0' }).toString()}`
})
const frame = ref<HTMLIFrameElement>()
const diagnostics = ref<{
  shell: boolean
  modal: boolean
  quick: boolean
  gridDisplay: string | null
  warnings: string[]
} | null>(null)
function onMessage(event: MessageEvent) {
  if (
    event.origin !== location.origin ||
    event.source !== frame.value?.contentWindow ||
    event.data?.type !== 'koba:ui-lab:diagnostics'
  )
    return
  diagnostics.value = event.data.data
  if (awaiting && event.data?.phase === 'final' && event.data.caseId === awaiting.id) {
    const pending = awaiting
    awaiting = null
    pending.resolve(event.data.data?.warnings || ['No diagnostic data'])
  }
}
async function runMatrix() {
  if (matrixRunning.value) return
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
  const autorun = new URLSearchParams(location.search).get('autorun')
  if (autorun === 'smoke' || autorun === 'extended' || autorun === 'full') {
    matrixMode.value = autorun
    setTimeout(() => void runMatrix(), 300)
  }
})
onBeforeUnmount(() => {
  stopMatrix()
  window.removeEventListener('message', onMessage)
})
function reload() {
  diagnostics.value = null
  if (frame.value) frame.value.src = frameUrl.value
}
</script>
<template>
  <main class="lab">
    <header class="topbar">
      <div><span class="eyebrow">Koba Infrastructure / локальная приёмка</span><h1>UI Acceptance Lab</h1><p>Реальный Shell и Vue-экраны · только синтетические адаптеры · никакой авторизации</p></div>
      <div class="flag">SYNTHETIC · NO NETWORK / NO IDB</div>
    </header>
    <section class="controls" aria-label="Параметры проверяемого интерфейса">
      <label>Продукт <select v-model="product"><option value="chatgpt">ChatGPT Booster</option><option value="vk">VK Booster</option><option value="all-in-one">All-in-one / ChatGPT</option><option value="all-in-one-vk">All-in-one / VK</option></select></label>
      <label>Данные <select v-model="scene"><option value="saved">Сохранено</option><option value="empty">Пустой архив</option><option value="loading">Загрузка</option><option value="error">Ошибка источника</option><option value="long">Длинный текст</option><option value="disabled">Установка выключена</option></select></label>
      <label>Начальный экран <select v-model="view"><option value="settings">Полные настройки</option><option value="quick">Быстрое меню</option><option value="archive">Архив</option><option value="closed">Закрыто / кнопка</option></select></label>
      <label>Доставка <select v-model="method"><option value="tampermonkey">Tampermonkey</option><option value="chromium">Chromium MV3</option></select></label>
      <label>Привязка <select v-model="side"><option value="right">Справа</option><option value="left">Слева</option></select></label>
      <label>Viewport <select v-model="size"><option value="desktop">Desktop 1365×780</option><option value="tablet">Tablet 768×790</option><option value="mobile">Mobile 390×780</option></select></label>
      <button class="reload" type="button" @click="reload">Сбросить состояние</button>
    </section>
    <div class="diagnostics" :class="{ bad: diagnostics?.warnings.length }" role="status">
      <strong>{{ diagnostics ? diagnostics.warnings.length ? 'Проблемы геометрии' : 'Геометрия без обнаруженных нарушений' : 'Проверка интерфейса…' }}</strong>
      <span v-if="diagnostics">Shell: {{ diagnostics.shell ? 'mounted' : 'missing' }} · Settings grid: {{ diagnostics.gridDisplay ?? '—' }} · Modal: {{ diagnostics.modal ? 'visible' : 'hidden' }} · Quick menu: {{ diagnostics.quick ? 'visible' : 'hidden' }}</span>
      <span v-for="warning in diagnostics?.warnings ?? []" :key="warning">{{ warning }}</span>
    </div>
    <section class="matrix-bar" aria-label="Автоматическая UI-матрица">
      <label>Приёмка <select v-model="matrixMode" :disabled="matrixRunning"><option value="smoke">Smoke · 96</option><option value="extended">Extended · 288</option><option value="full">Full · 1152</option></select></label>
      <button type="button" class="reload" :disabled="matrixRunning" @click="runMatrix">Прогнать матрицу</button>
      <button v-if="matrixRunning" type="button" class="reload" @click="stopMatrix">Остановить</button>
      <button v-if="matrixResults.length && !matrixRunning" type="button" class="reload" @click="downloadMatrixReport">JSON-отчёт</button>
      <output class="matrix-progress" role="status" aria-live="off" data-testid="matrix-progress">
        {{ matrixResults.length }} / {{ matrixTotal || buildLabMatrix(matrixMode).length }}
        · PASS {{ matrixSummary.passed }} · FAIL {{ matrixSummary.failed }}
        <span v-if="matrixRunning"> · {{ matrixCase?.id }}</span>
      </output>
      <div v-if="matrixResults.some(x => x.status === 'fail')" class="matrix-failures">
        <div v-for="row in matrixResults.filter(x => x.status === 'fail').slice(0, 10)" :key="row.id">{{ row.id }} — {{ row.warnings.join('; ') }}</div>
      </div>
    </section>
    <p class="lab-note">Каждое переключение создаёт новую песочницу. Перетаскивай боковую кнопку, раскрывай меню, меняй настройки и пробуй сбор: все данные фиктивные, операции не обращаются к ChatGPT или VK.</p>
    <section class="stage" aria-label="Изолированная область просмотра">
      <div class="viewport-caption">{{ frameSize[0] }} × {{ frameSize[1] }} px · {{ matrixCase?.product ?? product }} · {{ matrixCase?.scene ?? scene }}</div>
      <iframe ref="frame" :src="frameUrl" title="Booster UI — синтетический сценарий" :style="{width:frameSize[0]+'px',height:frameSize[1]+'px'}" />
    </section>
  </main>
</template>
