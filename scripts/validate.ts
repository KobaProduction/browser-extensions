import { manifest } from './catalog'
import { changedModules } from './changed'
import { channelVersion, chromeVersion, releaseChannel, userscriptChannelUrl } from './channels'
import { devExtensionPublicKeys } from './extension-keys'

const ids = ['vk-booster', 'chatgpt-booster', 'proxy-switcher', 'all-in-one'] as const
const capabilities = [
  'page-dom',
  'origin-storage',
  'local-files',
  'proxy-settings',
  'request-routing',
  'user-agent',
]
const names = new Set<string>()
const channel = releaseChannel(process.argv.find((x) => x.startsWith('--channel='))?.split('=')[1])
const run = Number(
  process.argv.find((x) => x.startsWith('--build-number='))?.split('=')[1] ??
    process.env.GITHUB_RUN_NUMBER ??
    '1',
)
for (const id of ids) {
  const m = await manifest(id)
  if (m.id !== id || names.has(m.id) || !/^[a-z][a-z0-9-]+$/.test(m.id))
    throw Error('Invalid module id: ' + id)
  if (!/^\d+\.\d+\.\d+$/.test(m.version)) throw Error('Invalid semver: ' + id)
  if (m.capabilities?.some((x) => !capabilities.includes(x))) throw Error('Invalid capabilities: ' + id)
  if (m.targets?.some((x) => !['userscript', 'chromium'].includes(x)))
    throw Error('Unsupported targets: ' + id)
  names.add(m.id)
}
const selector = process.argv[process.argv.indexOf('--module') + 1]
const checked =
  selector === 'changed'
    ? (await changedModules(process.env.BASE_SHA, process.env.HEAD_SHA || 'HEAD')).filter(
        (x) => x !== 'proxy-switcher',
      )
    : selector === 'vk-booster' || selector === 'chatgpt-booster' || selector === 'all-in-one'
      ? [selector]
      : ['vk-booster', 'chatgpt-booster', 'all-in-one']
if (process.argv.includes('--built'))
  for (const id of checked) {
    const m = await manifest(id)
    const root = `dist/${id}`
    const user = await Bun.file(`${root}/${id}.user.js`).text()
    if (
      !user.startsWith('// ==UserScript==') ||
      !user.includes(`// @version      ${channelVersion(m.version, channel, run)}`) ||
      !user.includes('GM_registerMenuCommand')
    )
      throw Error('Invalid userscript: ' + id)
    if (
      !user.includes(`// @updateURL    ${userscriptChannelUrl(id, channel)}`) ||
      !user.includes(`// @downloadURL  ${userscriptChannelUrl(id, channel)}`)
    )
      throw Error('Incorrect ' + channel + ' update channel: ' + id)
    if (
      id === 'chatgpt-booster' &&
      (!user.includes('// @match        https://chatgpt.com/*') ||
        !user.includes('// @grant        unsafeWindow') ||
        !user.includes('// @connect      *'))
    )
      throw Error('ChatGPT page observer and explicit telemetry grants missing')
    // A userscript/isolated content script does not have Node's process global.
    // Bundles can typecheck and build successfully while throwing on first load.
    if (/\bprocess\.env\.NODE_ENV\b/.test(user))
      throw Error('Unresolved Node environment in userscript: ' + id)
    const chrome = await Bun.file(`${root}/extension/manifest.json`).json()
    if (
      chrome.manifest_version !== 3 ||
      chrome.version !== chromeVersion(m.version, channel, run) ||
      chrome.version_name !== channelVersion(m.version, channel, run) ||
      (channel === 'dev' && chrome.key !== devExtensionPublicKeys[id]) ||
      (channel === 'prod' && Boolean(chrome.key)) ||
      chrome.permissions.includes('proxy')
    )
      throw Error('Invalid extension manifest: ' + id)
    if (id === 'all-in-one') {
      const dependencies = m.dependencies ?? []
      if (!dependencies.includes('vk-booster') || !dependencies.includes('chatgpt-booster'))
        throw Error('Aggregate distribution has lost its provider dependency graph')
      if (
        !user.includes('// @match        https://chatgpt.com/*') ||
        !user.includes('// @match        https://vk.ru/im*') ||
        !user.includes('// @grant        unsafeWindow') ||
        !user.includes('// @connect      *')
      )
        throw Error('Aggregate userscript does not include both provider capabilities')
      if (
        !chrome.host_permissions?.includes('https://chatgpt.com/*') ||
        !chrome.host_permissions?.includes('https://vk.ru/*') ||
        chrome.background?.service_worker !== 'background.js' ||
        !chrome.content_scripts?.some(
          (entry: { world?: string; js?: string[] }) =>
            entry.world === 'MAIN' && entry.js?.includes('observer.js'),
        ) ||
        !chrome.content_scripts?.some(
          (entry: { matches?: string[]; js?: string[] }) =>
            entry.matches?.includes('https://chatgpt.com/*') && entry.js?.includes('content.js'),
        )
      )
        throw Error('Aggregate MV3 distribution does not include both host adapters')
    }
    if (
      id === 'vk-booster' &&
      (user.includes('// @match        https://chatgpt.com/*') ||
        chrome.host_permissions?.includes('https://chatgpt.com/*'))
    )
      throw Error('VK standalone gained ChatGPT permissions or runtime')
    if (id === 'chatgpt-booster') {
      const hosts = chrome.host_permissions as unknown
      if (
        !Array.isArray(hosts) ||
        hosts.length !== 1 ||
        hosts[0] !== 'https://chatgpt.com/*' ||
        !Array.isArray(chrome.optional_host_permissions) ||
        chrome.optional_host_permissions.length !== 1 ||
        chrome.optional_host_permissions[0] !== 'https://*/*' ||
        chrome.background?.service_worker !== 'background.js' ||
        !Array.isArray(chrome.content_scripts) ||
        chrome.content_scripts.length !== 2 ||
        chrome.content_scripts[0]?.world !== 'MAIN' ||
        chrome.content_scripts[0]?.js?.[0] !== 'observer.js' ||
        chrome.content_scripts[1]?.js?.[0] !== 'content.js'
      )
        throw Error('ChatGPT isolated browser observer/manifest contract changed')
    }
    const content = await Bun.file(`${root}/extension/content.js`).text()
    if (id === 'all-in-one' && (!content.includes('chatgpt-booster') || !content.includes('vk-booster')))
      throw Error('Aggregate MV3 content bundle does not contain both modules')
    if (id === 'vk-booster' && content.includes('chatgpt-booster:telemetry-post'))
      throw Error('VK-only binary contains ChatGPT telemetry transport')
    if (id === 'all-in-one' && (!user.includes('chatgpt-booster') || !user.includes('VKExport')))
      throw Error('Aggregate userscript does not contain both product features')
    if (/\bprocess\.env\.NODE_ENV\b/.test(content))
      throw Error('Unresolved Node environment in extension content script: ' + id)
    for (const path of [
      'content.js',
      'popup.js',
      'popup.html',
      ...(id === 'chatgpt-booster' || id === 'all-in-one' ? ['observer.js', 'background.js'] : []),
      `${id}-extension.zip`,
    ]) {
      const file = path.endsWith('.zip') ? `${root}/${path}` : `${root}/extension/${path}`
      if (!(await Bun.file(file).exists())) throw Error('Missing artifact: ' + file)
    }
  }
console.log('Module catalog and outputs valid')
