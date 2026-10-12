import { expect, test } from 'bun:test'
import { isProxy, reactive } from 'vue'
import { buildLabMatrix, matrixReport } from './matrix'

test('matrix covers source, surface, viewport, delivery and launcher edge deterministically', () => {
  const smoke = buildLabMatrix('smoke')
  const extended = buildLabMatrix('extended')
  const full = buildLabMatrix('full')
  expect(smoke).toHaveLength(96)
  expect(extended).toHaveLength(288)
  expect(full).toHaveLength(1152)
  for (const cases of [smoke, extended, full]) {
    expect(new Set(cases.map((row) => row.id)).size).toBe(cases.length)
    expect(new Set(cases.map((row) => row.product)).size).toBe(4)
    expect(new Set(cases.map((row) => row.scene)).size).toBe(6)
    expect(new Set(cases.map((row) => row.view)).size).toBe(4)
    expect(new Set(cases.map((row) => row.method)).size).toBe(2)
    expect(new Set(cases.map((row) => row.side)).size).toBe(2)
    expect(new Set(cases.map((row) => row.viewport)).size).toBe(3)
  }
  expect(
    full.filter(
      (x) => x.product === 'vk' && x.scene === 'saved' && x.view === 'quick' && x.viewport === 'mobile',
    ),
  ).toHaveLength(4)
})

test('report does not treat unexecuted cases as passed', () => {
  const cases = buildLabMatrix('smoke')
  const result = matrixReport('smoke', cases, [
    { id: cases.at(0)?.id ?? 'missing', status: 'fail', warnings: ['UI overflow'], elapsedMs: 110 },
  ])
  expect(result).toMatchObject({ total: 96, executed: 1, passed: 0, failed: 1 })
  expect(result.failures[0]?.warnings).toContain('UI overflow')
})

test('test runner captures browser exceptions as failures and does not confuse levels of acceptance', async () => {
  const source = await Bun.file(new URL('./preview.ts', import.meta.url)).text()
  expect(source).toContain("window.addEventListener('unhandledrejection'")
  expect(source).toContain('const warnings: string[] = [...browserErrors]')
  const runner = await Bun.file(new URL('../scripts/browser-matrix.mjs', import.meta.url)).text()
  expect(runner).toContain('MATRIX_BROWSER_FAILURE')
  expect(runner).toContain('report.failed === 0 && report.executed === report.total')
  expect(runner).toContain('MALFORMED_FAILURE_RECORD')
  const pipeline = await Bun.file(
    new URL('../../../.github/workflows/ui-acceptance.yml', import.meta.url),
  ).text()
  expect(pipeline).toContain('include-hidden-files: true')
})

test('aggregate browser matrix checks against duplicate platform navigation', async () => {
  const code = await Bun.file(new URL('./preview.ts', import.meta.url)).text()
  expect(code).toContain('Duplicate platform navigation in single-host aggregate')
  expect(code).toContain("scene.product.startsWith('all-in-one')")
})

test('failure evidence is a cloneable snapshot of reactive Vue matrix state', () => {
  const cases = buildLabMatrix('smoke')
  const id = cases[0]?.id ?? 'missing'
  const rows = reactive([
    { id, status: 'fail' as const, warnings: ['Synthetic viewport overflow'], elapsedMs: 42 },
  ])
  const report = matrixReport('smoke', cases, rows)
  const failure = report.failures[0]
  expect(isProxy(failure)).toBe(false)
  expect(isProxy(failure?.warnings)).toBe(false)
  expect(structuredClone(report)).toEqual(report)
  expect(JSON.parse(JSON.stringify(report)).failures).toEqual([
    { id, status: 'fail', warnings: ['Synthetic viewport overflow'], elapsedMs: 42 },
  ])

  rows[0]?.warnings.push('Later live-state warning')
  if (rows[0]) rows[0].elapsedMs = 99
  expect(failure).toEqual({
    id,
    status: 'fail',
    warnings: ['Synthetic viewport overflow'],
    elapsedMs: 42,
  })
})
