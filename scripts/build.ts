import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import ts from 'typescript'
import { build as viteBuild } from 'vite'
import { buildChatGptModule } from './build-chatgpt'
import {
  assertIsolatedDexieBundle,
  browserDependencyAliases,
  deliveryTarget,
  packExtension,
} from './build-platform'
import { manifest } from './catalog'
import { changedModules } from './changed'
import {
  channelDisplayName,
  channelIdentity,
  channelVersion,
  chromeVersion,
  devDisplayVersion,
  releaseChannel,
  userscriptChannelName,
  userscriptChannelUrl,
} from './channels'
import { devExtensionPublicKeys } from './extension-keys'

const root = resolve(import.meta.dir, '..')
process.chdir(root)
const requested =
  process.argv.find((a) => a.startsWith('--module='))?.split('=')[1] ??
  process.argv.slice(2).find((_x, i, arr) => arr[i - 1] === '--module') ??
  'all'
const target = process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'both'
const channel = releaseChannel(process.argv.find((a) => a.startsWith('--channel='))?.split('=')[1])
let currentProduct: string | null = null
const ids =
  requested === 'all'
    ? ['vk-booster', 'chatgpt-booster', 'all-in-one']
    : requested === 'changed'
      ? (await changedModules(process.env.BASE_SHA, process.env.HEAD_SHA || 'HEAD')).filter(
          (id) => id !== 'proxy-switcher',
        )
      : [requested]
if (!['both', 'userscript', 'extension'].includes(target)) throw Error('Invalid --target')

function plugins() {
  return [vue(), tailwindcss()]
}
async function viteBundle(
  src: string,
  dir: string,
  file: string,
  format: 'es' | 'iife' = 'iife',
  external: string[] = [],
  productVersion?: string,
) {
  const application = currentProduct ? await manifest(currentProduct) : null
  const components =
    currentProduct === 'all-in-one'
      ? await Promise.all(
          ['vk-booster', 'chatgpt-booster'].map(async (id) => {
            const component = await manifest(id)
            return { id, title: component.name, version: component.version }
          }),
        )
      : []
  await viteBuild({
    configFile: false,
    root,
    logLevel: 'error',
    plugins: plugins(),
    resolve: { alias: browserDependencyAliases(root) },
    // Browser bundles must not depend on Node globals. Vue's published runtime
    // still refers to process.env.NODE_ENV when bundled as an IIFE library.
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': '{}',
      __BOOSTER_BUILD_VERSION__: JSON.stringify(productVersion ?? ''),
      __VK_BUILD_VERSION__: JSON.stringify((await manifest('vk-booster')).version),
      __BOOSTER_APPLICATION_VERSION__: JSON.stringify(application?.version ?? ''),
      __BOOSTER_APPLICATION__: JSON.stringify(
        application
          ? {
              id: currentProduct,
              title: application.name,
              version: devDisplayVersion(application.version, channel),
              components,
            }
          : null,
      ),
      __BOOSTER_BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? ''),
      __BOOSTER_INSTANCE_SCOPE__: JSON.stringify(
        currentProduct ? channelIdentity(currentProduct, channel) : '',
      ),
      __BOOSTER_DELIVERY_TARGET__: JSON.stringify(deliveryTarget(src)),
    },
    build: {
      outDir: dir,
      emptyOutDir: true,
      minify: false,
      cssCodeSplit: false,
      lib: { entry: src, formats: [format], name: 'KobaBrowserTools', fileName: () => file },
      rollupOptions: external.length ? { external } : undefined,
    },
  })
  const output = await readFile(join(dir, file), 'utf8')
  assertIsolatedDexieBundle(output)
  return output
}
function emitTypes(name: string, src: string, dir: string) {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw Error('Cannot read TypeScript config')
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    paths: {
      ...parsed.options.paths,
      '@kobaproduction/browser-core': ['packages/core/dist/index.d.ts'],
      '@kobaproduction/browser-storage': ['packages/storage/dist/index.d.ts'],
      '@kobaproduction/browser-archive': ['packages/archive/dist/index.d.ts'],
    },
    rootDir: join(root, 'packages', name, 'src'),
    outDir: dir,
  }
  const program = ts.createProgram([src], options)
  const emit = program.emit()
  const errors = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics]
  if (emit.emitSkipped || errors.some((x) => x.category === ts.DiagnosticCategory.Error)) {
    throw Error(
      'Declaration emit failed: ' +
        name +
        ' ' +
        errors
          .map((x) => ts.flattenDiagnosticMessageText(x.messageText, ' '))
          .join('; ')
          .slice(0, 1100),
    )
  }
}
async function pack(name: string) {
  const src = join(root, 'packages', name, 'src', 'index.ts')
  const dir = join(root, 'packages', name, 'dist')
  await mkdir(dir, { recursive: true })
  if (name === 'ui' || name === 'shell' || name === 'widgets') {
    await viteBundle(src, dir, 'index.js', 'es', [
      'vue',
      'lucide-vue-next',
      '@kobaproduction/browser-core',
      '@kobaproduction/browser-ui',
      'clsx',
      'tailwind-merge',
      'dexie',
    ])
    await copyFile(join(root, 'packages', name, 'types/index.d.ts'), join(dir, 'index.d.ts'))
    if (name === 'widgets') {
      const widgetsSrc = join(root, 'packages', name, 'src')
      const css = await Promise.all([
        readFile(join(widgetsSrc, 'archive-conversation-list.css'), 'utf8'),
        readFile(join(widgetsSrc, 'archive-transcript.css'), 'utf8'),
        readFile(join(widgetsSrc, 'archive-metadata.css'), 'utf8'),
      ])
      await writeFile(join(dir, 'styles.css'), css.join('\n'))
    }
  } else {
    const compiled = await Bun.build({
      entrypoints: [src],
      target: 'browser',
      format: 'esm',
      outdir: dir,
      external: [
        '@kobaproduction/browser-core',
        '@kobaproduction/browser-adapters',
        '@kobaproduction/browser-ui',
        'dexie',
      ],
    })
    if (!compiled.success) throw Error(`Shared package build failed: ${name}`)
    emitTypes(name, src, dir)
  }
}
for (const name of ['core', 'storage', 'archive', 'adapters', 'ui', 'widgets', 'shell']) await pack(name)
if (requested === 'packages') {
  console.log('Shared packages built')
  process.exit(0)
}
for (const id of ids) {
  currentProduct = id
  const info = await manifest(id)
  if (info.version === '0.0.0')
    throw Error('No assigned release version. Fetch origin dev and its rolling tags before packaging.')
  if (!info.release) throw Error(`Module ${id} is not releasable`)
  if (id === 'chatgpt-booster') {
    await buildChatGptModule(root, target, info.version, viteBundle, channel)
    continue
  }
  const dir = join(root, 'dist', id)
  await mkdir(dir, { recursive: true })
  if (target !== 'extension') {
    const src = join(
      root,
      'apps/userscript/src',
      id === 'vk-booster' ? 'vk-booster.ts' : 'all-in-one.ts',
    )
    const output = await viteBundle(
      src,
      join(dir, '_userscript'),
      'bundle.js',
      'iife',
      [],
      id === 'all-in-one' ? (await manifest('chatgpt-booster')).version : undefined,
    )
    const url = userscriptChannelUrl(id, channel)
    const header = [
      '// ==UserScript==',
      `// @name         ${userscriptChannelName(info.name, channel)}`,
      '// @namespace    https://github.com/KobaProduction/browser-extensions' +
        (channel === 'dev' ? `/dev/${id}` : ''),
      `// @version      ${channelVersion(info.version, channel)}`,
      `// @description  Koba Browser Tools / ${info.name}`,
      '// @homepageURL   https://github.com/KobaProduction/browser-extensions',
      `// @updateURL    ${url}`,
      `// @downloadURL  ${url}`,
      '// @match        https://vk.ru/*',
      '// @match        https://vk.com/*',
      ...(id === 'all-in-one' ? ['// @match        https://chatgpt.com/*'] : []),
      `// @run-at       ${id === 'all-in-one' ? 'document-start' : 'document-idle'}`,
      '// @grant        GM_info',
      '// @grant        GM_registerMenuCommand',
      '// @grant        GM_getValue',
      '// @grant        GM_setValue',
      '// @grant        GM_deleteValue',
      '// @grant        GM_listValues',
      '// @grant        GM_addValueChangeListener',
      '// @grant        GM_removeValueChangeListener',
      '// @grant        GM_xmlhttpRequest',
      '// @connect      *',
      ...(id === 'all-in-one' ? ['// @grant        unsafeWindow'] : []),
      '// @sandbox      raw',
      '// ==/UserScript==',
      '',
    ].join('\n')
    await writeFile(join(dir, `${id}.user.js`), `${header}\n${output}`)
  }
  if (target !== 'userscript') {
    const ext = join(dir, 'extension')
    await mkdir(ext, { recursive: true })
    const content = await viteBundle(
      join(root, 'apps/extension/src', id === 'all-in-one' ? 'all-in-one-content.ts' : 'content.ts'),
      join(dir, '_content'),
      'bundle.js',
      'iife',
      [],
      id === 'all-in-one' ? (await manifest('chatgpt-booster')).version : undefined,
    )
    await writeFile(join(ext, 'content.js'), content)
    const popup = await viteBundle(
      join(root, 'apps/extension/src', id === 'all-in-one' ? 'all-in-one-popup.ts' : 'popup.ts'),
      join(dir, '_popup'),
      'bundle.js',
      'es',
    )
    await writeFile(join(ext, 'popup.js'), popup)
    const base = JSON.parse(await readFile('apps/extension/src/manifest.json', 'utf8'))
    base.version = chromeVersion(info.version, channel)
    base.version_name = devDisplayVersion(info.version, channel)
    if (channel === 'dev') base.key = devExtensionPublicKeys[id]
    base.name = channelDisplayName(info.name, channel)
    if (channel === 'dev') base.incognito = 'split'
    base.permissions = [...new Set([...base.permissions, 'alarms'])]
    base.optional_host_permissions = ['https://*/*']
    base.background = { service_worker: 'background.js', type: 'module' }
    if (id !== 'all-in-one') {
      await viteBundle(
        join(root, 'apps/extension/src/shared-background.ts'),
        join(dir, '_background'),
        'bundle.js',
        'es',
      )
      await copyFile(join(dir, '_background/bundle.js'), join(ext, 'background.js'))
    }
    await writeFile(join(ext, 'manifest.json'), `${JSON.stringify(base, null, 2)}\n`)
    await copyFile(join(root, 'apps/extension/src/popup.html'), join(ext, 'popup.html'))
    if (id === 'all-in-one') {
      base.host_permissions.push('https://chatgpt.com/*')
      base.permissions.push('scripting')
      base.optional_host_permissions = ['https://*/*']
      base.content_scripts.push(
        {
          matches: ['https://chatgpt.com/*'],
          js: ['observer.js'],
          run_at: 'document_start',
          world: 'MAIN',
        },
        { matches: ['https://chatgpt.com/*'], js: ['content.js'], run_at: 'document_start' },
      )
      base.background = { service_worker: 'background.js', type: 'module' }
      // MV3 observer/background are the same domain adapter used by the
      // standalone ChatGPT extension, never a fork of archive business logic.
      await viteBundle(
        join(root, 'modules/chatgpt-booster/packages/extension/src/observer/index.ts'),
        join(dir, '_observer'),
        'bundle.js',
        'iife',
        [],
        (await manifest('chatgpt-booster')).version,
      )
      await copyFile(join(dir, '_observer', 'bundle.js'), join(ext, 'observer.js'))
      await viteBundle(
        join(root, 'apps/extension/src/chatgpt-background.ts'),
        join(dir, '_background'),
        'bundle.js',
        'es',
        [],
        (await manifest('chatgpt-booster')).version,
      )
      await copyFile(join(dir, '_background', 'bundle.js'), join(ext, 'background.js'))
      await writeFile(join(ext, 'manifest.json'), `${JSON.stringify(base, null, 2)}\n`)
    }
    await packExtension(ext, join(dir, `${id}-extension.zip`))
  }
  console.log(`Built ${id} ${info.version} (${target})`)
}
