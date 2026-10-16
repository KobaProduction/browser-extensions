import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

/** Dexie's package wrapper joins the page's Symbol.for('Dexie') singleton.
 * Browser deliveries own their bundled implementation and must not join the
 * host application's version or connections. The public ESM implementation
 * has no singleton registration; resolving one exact file also deduplicates it. */
export function browserDependencyAliases(root: string) {
  const require = createRequire(join(root, 'packages/storage/package.json'))
  return [{ find: /^dexie$/, replacement: require.resolve('dexie/dist/dexie.mjs') }]
}

export function assertIsolatedDexieBundle(source: string): void {
  if (/Symbol\.for\(\s*['"]Dexie['"]\s*\)/.test(source))
    throw Error('Browser bundle must not access the host Dexie singleton')
  const copies = source.match(/\b(?:var|const|let)\s+DEXIE_VERSION(?:\$\d+)?\s*=/g)?.length ?? 0
  if (copies > 1) throw Error('Browser bundle contains multiple Dexie implementations')
}

export function deliveryTarget(source: string): 'chromium' | 'userscript' {
  const path = source.replaceAll('\\', '/')
  return path.includes('/apps/extension/') || path.includes('/packages/extension/')
    ? 'chromium'
    : 'userscript'
}

/** Package the directory contents, with the manifest at the ZIP root on every OS. */
export async function packExtension(source: string, destination: string): Promise<void> {
  const output = resolve(destination)
  await rm(output, { force: true })
  const windows = process.platform === 'win32'
  const child = spawn(
    windows ? 'powershell.exe' : 'zip',
    windows
      ? [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          [
            "$ErrorActionPreference = 'Stop'",
            'Add-Type -AssemblyName System.IO.Compression',
            'Add-Type -AssemblyName System.IO.Compression.FileSystem',
            '$root = $env:KOBA_ZIP_SOURCE',
            '$archive = [System.IO.Compression.ZipFile]::Open($env:KOBA_ZIP_DESTINATION, [System.IO.Compression.ZipArchiveMode]::Create)',
            'try { foreach ($file in [System.IO.Directory]::EnumerateFiles($root, "*", [System.IO.SearchOption]::AllDirectories)) { $name = $file.Substring($root.Length + 1).Replace([char]92, [char]47); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $name) | Out-Null } } finally { $archive.Dispose() }',
          ].join('; '),
        ]
      : ['-q', '-r', output, '.'],
    {
      cwd: source,
      stdio: 'inherit',
      env: {
        ...process.env,
        KOBA_ZIP_SOURCE: resolve(source),
        KOBA_ZIP_DESTINATION: output,
      },
    },
  )
  await new Promise<void>((done, fail) => {
    child.once('error', fail)
    child.once('exit', (code) =>
      code === 0 ? done() : fail(new Error(`ZIP packaging failed (${code})`)),
    )
  })
}
