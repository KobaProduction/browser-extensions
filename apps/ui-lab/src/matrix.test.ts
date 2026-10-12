import { expect, test } from 'bun:test'
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
})
