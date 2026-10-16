import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { computed, ref } from 'vue'
import { parse } from 'vue/compiler-sfc'
import type { ArchiveCoverageView } from './mount'

const { descriptor } = parse(readFileSync(new URL('ArchiveExportDialog.vue', import.meta.url), 'utf8'))
const source = ts.createSourceFile(
  'ArchiveExportDialog.ts',
  descriptor.scriptSetup?.content ?? '',
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
)
/** Execute the actual SFC derived state, without duplicating its summary policy in a test helper. */
function derived(name: string, coverage?: ArchiveCoverageView) {
  let initializer: ts.Expression | undefined
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      initializer = node.initializer
    ts.forEachChild(node, find)
  }
  find(source)
  if (!initializer) throw Error(`Missing SFC derived state: ${name}`)
  const values = {
    computed,
    props: { archiveAdapter: {} },
    coverage: ref(coverage),
    readiness: ref(undefined),
    readinessLoading: ref(false),
    readinessDirty: ref(false),
    readinessFailed: ref(false),
    activeBlockers: ref([]),
    isCurrent: ref(true),
  }
  const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `const result = ${initializer.getText(source)};`,
  )
  return new Function(...Object.keys(values), `${body}\nreturn result.value;`)(
    ...Object.values(values),
  ) as string | number | undefined
}
const saved = (patch: Partial<ArchiveCoverageView> = {}): ArchiveCoverageView => ({
  conversationId: 'synthetic-export',
  knownMessageCount: 26,
  hasOlderServerHistory: null,
  completeAtLastRead: false,
  lastFullReadAt: null,
  ...patch,
})
const integrity: NonNullable<ArchiveCoverageView['integrity']> = {
  start: 'unknown',
  end: 'unknown',
  chain: 'unknown',
  roots: [],
  tips: [],
  branches: [],
  issues: [],
}

test('fixed saved records remain visible without a legacy visible/internal count split', () => {
  const coverage = saved({ integrity, storedLatestMatchesCurrent: false })
  expect(derived('savedRecordCount', coverage)).toBe(26)
  expect(derived('statusKey', coverage)).toBe('export.statusExtentUnknown')
  expect(coverage.visibleMessageCount).toBeUndefined()
  expect(coverage.internalRecordCount).toBeUndefined()
})

test('unknown coverage does not become an empty or proven incomplete saved copy', () => {
  expect(derived('savedRecordCount')).toBeUndefined()
  expect(derived('statusKey')).toBe('export.statusUnknown')
  expect(derived('statusKey', saved())).toBe('export.statusExtentUnknown')
  expect(derived('savedRecordCount', saved({ knownMessageCount: 0 }))).toBe(0)
  expect(derived('statusKey', saved({ knownMessageCount: 0 }))).toBe('export.statusMissing')
})

test('proven gaps, verified chains and explicit older-history evidence retain distinct summaries', () => {
  expect(derived('statusKey', saved({ integrity: { ...integrity, chain: 'gaps' } }))).toBe(
    'export.statusGaps',
  )
  expect(derived('statusKey', saved({ integrity: { ...integrity, chain: 'verified' } }))).toBe(
    'export.statusSaved',
  )
  expect(derived('statusKey', saved({ hasOlderServerHistory: true }))).toBe('export.statusPartial')
})
