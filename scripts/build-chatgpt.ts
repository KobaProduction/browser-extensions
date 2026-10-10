import { spawn } from 'node:child_process'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { channelVersion, chromeVersion, type ReleaseChannel, userscriptChannelUrl } from './channels'
import { devExtensionPublicKeys } from './extension-keys'

type Bundle = (
  src: string,
  dir: string,
  file: string,
  format?: 'es' | 'iife',
  external?: string[],
  productVersion?: string,
) => Promise<string>

/** One ChatGPT delivery artifact builder shared by module-scoped and aggregate builds. */
export async function buildChatGptModule(
  root: string,
  target: string,
  version: string,
  bundle: Bundle,
  channel: ReleaseChannel,
  run: number,
) {
  const id = 'chatgpt-booster'
  const dir = join(root, 'dist', id)
  const extRoot = join(root, 'modules', id, 'packages', 'extension')
  await mkdir(dir, { recursive: true })
  if (target !== 'extension') {
    const output = await bundle(
      join(root, 'apps/userscript/src/chatgpt-standalone.ts'),
      join(dir, '_userscript'),
      'bundle.js',
      'iife',
      [],
      version,
    )
    const header = [
      '// ==UserScript==',
      '// @name         ChatGPT Booster' + (channel === 'dev' ? ' [DEV]' : ''),
      '// @namespace    https://github.com/KobaProduction/browser-extensions' +
        (channel === 'dev' ? '/dev/chatgpt-booster' : ''),
      '// @version      ' + channelVersion(version, channel, run),
      '// @description  ChatGPT Booster — archive and browser tools',
      '// @updateURL    ' + userscriptChannelUrl(id, channel),
      '// @downloadURL  ' + userscriptChannelUrl(id, channel),
      '// @match        https://chatgpt.com/*',
      '// @run-at       document-start',
      '// @grant        GM_registerMenuCommand',
      '// @grant        GM_getValue',
      '// @grant        GM_setValue',
      '// @grant        GM_xmlhttpRequest',
      '// @grant        unsafeWindow',
      '// @connect      *',
      '// @sandbox      raw',
      '// ==/UserScript==',
      '',
    ].join('\n')
    await writeFile(join(dir, id + '.user.js'), header + '\n' + output)
  }
  if (target !== 'userscript') {
    const ext = join(dir, 'extension')
    await mkdir(ext, { recursive: true })
    await bundle(
      join(root, 'apps/extension/src/chatgpt-standalone.ts'),
      join(dir, '_content'),
      'bundle.js',
      'iife',
      [],
      version,
    )
    await copyFile(join(dir, '_content', 'bundle.js'), join(ext, 'content.js'))
    await bundle(
      join(extRoot, 'src/observer/index.ts'),
      join(dir, '_observer'),
      'bundle.js',
      'iife',
      [],
      version,
    )
    await copyFile(join(dir, '_observer', 'bundle.js'), join(ext, 'observer.js'))
    await bundle(
      join(extRoot, 'src/background/index.ts'),
      join(dir, '_background'),
      'bundle.js',
      'es',
      [],
      version,
    )
    await copyFile(join(dir, '_background', 'bundle.js'), join(ext, 'background.js'))
    await bundle(
      join(extRoot, 'src/popup/main.ts'),
      join(dir, '_popup'),
      'bundle.js',
      'iife',
      [],
      version,
    )
    await copyFile(join(dir, '_popup', 'bundle.js'), join(ext, 'popup.js'))
    let html = await readFile(join(extRoot, 'src/popup/index.html'), 'utf8')
    html = html.replace(
      '<script type="module" src="./main.ts"></script>',
      '<script src="popup.js"></script>',
    )
    await writeFile(join(ext, 'popup.html'), html)
    const manifest = {
      manifest_version: 3,
      name: 'ChatGPT Booster' + (channel === 'dev' ? ' [DEV]' : ''),
      version: chromeVersion(version, channel, run),
      version_name: channelVersion(version, channel, run),
      ...(channel === 'dev' ? { key: devExtensionPublicKeys[id] } : {}),
      description: 'ChatGPT archive with shared browser tools shell',
      permissions: ['storage', 'scripting'],
      host_permissions: ['https://chatgpt.com/*'],
      // This is NOT granted on installation. Explicit user action is required for a configured HTTPS telemetry endpoint.
      optional_host_permissions: ['https://*/*'],
      action: { default_title: 'ChatGPT Booster', default_popup: 'popup.html' },
      content_scripts: [
        {
          matches: ['https://chatgpt.com/*'],
          js: ['observer.js'],
          run_at: 'document_start',
          world: 'MAIN',
        },
        { matches: ['https://chatgpt.com/*'], js: ['content.js'], run_at: 'document_start' },
      ],
      background: { service_worker: 'background.js', type: 'module' },
    }
    await writeFile(join(ext, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    const child = spawn('zip', ['-q', '-r', '../chatgpt-booster-extension.zip', '.'], {
      cwd: ext,
      stdio: 'inherit',
    })
    await new Promise<void>((done, fail) => {
      child.once('exit', (code) => (code === 0 ? done() : fail(new Error('ZIP packaging failed'))))
      child.once('error', fail)
    })
  }
  console.log('Built ChatGPT Booster', version, '(' + target + ')')
}
