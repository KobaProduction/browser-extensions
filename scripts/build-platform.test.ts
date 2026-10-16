import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { build } from 'vite'
import {
  assertIsolatedDexieBundle,
  browserDependencyAliases,
  deliveryTarget,
  packExtension,
} from './build-platform'

test('delivery target handles Windows and POSIX source paths', () => {
  for (const root of ['/workspace/', 'C:\\workspace\\']) {
    for (const entry of [
      'apps/extension/src/content.ts',
      'modules/chatgpt/packages/extension/src/observer/index.ts',
    ]) {
      const source = root + (root.includes('\\') ? entry.replaceAll('/', '\\') : entry)
      expect(deliveryTarget(source)).toBe('chromium')
    }
    expect(deliveryTarget(`${root}apps/userscript/src/all-in-one.ts`)).toBe('userscript')
  }
})

test('browser bundle uses one owned Dexie implementation and leaves a different host singleton intact', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'koba-dexie-bundle-'))
  try {
    const entry = join(temporary, 'entry.ts')
    await writeFile(
      entry,
      `import Dexie, { Dexie as NamedDexie } from 'dexie'
export const implementation = Dexie
export const sharedConstructor = Dexie === NamedDexie
export async function roundTrip(name) {
  const database = new Dexie(name)
  database.version(1).stores({ records: '&id' })
  try {
    await database.table('records').put({ id: 'synthetic', value: 'owned' })
    return await database.table('records').get('synthetic')
  } finally { await database.delete() }
}`,
    )
    const result = await build({
      configFile: false,
      root: join(import.meta.dir, '..'),
      logLevel: 'error',
      resolve: { alias: browserDependencyAliases(join(import.meta.dir, '..')) },
      build: {
        write: false,
        minify: false,
        lib: { entry, name: 'SyntheticDexieBundle', formats: ['iife'] },
      },
    })
    const compiled = Array.isArray(result) ? result[0] : result
    if (!compiled || !('output' in compiled)) throw Error('Missing synthetic browser bundle')
    const chunk = compiled.output.find((output) => output.type === 'chunk')
    if (chunk?.type !== 'chunk') throw Error('Missing synthetic browser code')
    assertIsolatedDexieBundle(chunk.code)
    const foreignDexie = Object.freeze({ semVer: '4.4.5', hostOnly: true })
    const page: Record<string | symbol, unknown> = {
      indexedDB: new IDBFactory(),
      IDBKeyRange,
      CustomEvent,
      AbortController,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      structuredClone,
      console,
    }
    Object.defineProperty(page, Symbol.for('Dexie'), { value: foreignDexie })
    runInNewContext(chunk.code, page)
    const bundle = page.SyntheticDexieBundle as {
      implementation: { semVer: string }
      sharedConstructor: boolean
      roundTrip(name: string): Promise<unknown>
    }
    expect(bundle.implementation).not.toBe(foreignDexie)
    expect(bundle.implementation.semVer).not.toBe(foreignDexie.semVer)
    expect(bundle.sharedConstructor).toBe(true)
    expect(await bundle.roundTrip('synthetic-build-private-dexie')).toEqual({
      id: 'synthetic',
      value: 'owned',
    })
    expect(page[Symbol.for('Dexie')]).toBe(foreignDexie)
  } finally {
    await rm(join(temporary, 'entry.ts'), { force: true })
    await rmdir(temporary)
  }
})

test('browser output gate rejects a host singleton wrapper or duplicate embedded Dexie copies', () => {
  expect(() => assertIsolatedDexieBundle('globalThis[Symbol.for("Dexie")]')).toThrow('host Dexie')
  expect(() =>
    assertIsolatedDexieBundle('var DEXIE_VERSION = "4.4.6"; var DEXIE_VERSION$1 = "4.4.6";'),
  ).toThrow('multiple Dexie')
})

function zipPaths(bytes: Buffer): string[] {
  const count = bytes.readUInt16LE(bytes.length - 12)
  let offset = bytes.readUInt32LE(bytes.length - 6)
  const paths: string[] = []
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50)
    const nameLength = bytes.readUInt16LE(offset + 28)
    paths.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'))
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
  }
  return paths.filter((path) => !path.endsWith('/')).sort()
}

test('extension ZIP has relative entries and replaces stale package contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'koba-extension-'))
  try {
    const source = join(root, 'source with spaces')
    const output = join(root, 'extension with spaces.zip')
    await mkdir(join(source, 'assets'), { recursive: true })
    await writeFile(join(source, 'manifest.json'), '{"manifest_version":3}')
    await writeFile(join(source, 'assets', 'stale.js'), 'old')
    await packExtension(source, output)
    expect(zipPaths(await readFile(output))).toEqual(['assets/stale.js', 'manifest.json'])
    await rm(join(source, 'assets', 'stale.js'))
    await writeFile(join(source, 'content.js'), 'new')
    await packExtension(source, output)
    expect(zipPaths(await readFile(output))).toEqual(['content.js', 'manifest.json'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
