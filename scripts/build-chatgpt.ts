import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { packExtension } from './build-platform'
import {
  channelDisplayName,
  channelVersion,
  chromeVersion,
  devDisplayVersion,
  type ReleaseChannel,
  userscriptChannelName,
  userscriptChannelUrl,
} from './channels'
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
      `// @name         ${userscriptChannelName('ChatGPT Booster', channel)}`,
      '// @namespace    https://github.com/KobaProduction/browser-extensions' +
        (channel === 'dev' ? '/dev/chatgpt-booster' : ''),
      `// @version      ${channelVersion(version, channel, run)}`,
      '// @description  ChatGPT Booster — archive and browser tools',
      `// @updateURL    ${userscriptChannelUrl(id, channel)}`,
      `// @downloadURL  ${userscriptChannelUrl(id, channel)}`,
      '// @match        https://chatgpt.com/*',
      '// @run-at       document-start',
      ...(channel === 'dev' ? ['// @run-in       incognito-tabs'] : []),
      '// @grant        GM_info',
      '// @grant        GM_registerMenuCommand',
      '// @grant        GM_getValue',
      '// @grant        GM_setValue',
      '// @grant        GM_deleteValue',
      '// @grant        GM_listValues',
      '// @grant        GM_addValueChangeListener',
      '// @grant        GM_removeValueChangeListener',
      '// @grant        GM_xmlhttpRequest',
      '// @grant        unsafeWindow',
      '// @connect      *',
      '// @sandbox      raw',
      '// ==/UserScript==',
      '',
    ].join('\n')
    await writeFile(join(dir, `${id}.user.js`), `${header}\n${output}`)
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
      join(root, 'apps/extension/src/chatgpt-background.ts'),
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
      ...(channel === 'dev' ? { incognito: 'split' } : {}),
      name: channelDisplayName('ChatGPT Booster', channel),
      version: chromeVersion(version, channel, run),
      version_name: devDisplayVersion(version, channel, run),
      ...(channel === 'dev' ? { key: devExtensionPublicKeys[id] } : {}),
      description: 'ChatGPT archive with shared browser tools shell',
      permissions: ['storage', 'scripting', 'alarms'],
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
    await writeFile(join(ext, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await packExtension(ext, join(dir, 'chatgpt-booster-extension.zip'))
  }
  console.log('Built ChatGPT Booster', version, `(${target})`)
}
