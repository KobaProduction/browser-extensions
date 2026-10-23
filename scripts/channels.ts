import { parseVersion } from './release-versions'

/** Channels isolate installation data; they do not allocate competing versions. */
export type ReleaseChannel = 'dev' | 'prod'

export function releaseChannel(raw: string | undefined): ReleaseChannel {
  if (!raw || raw === 'prod') return 'prod'
  if (raw === 'dev') return 'dev'
  throw new Error(`Unknown release channel: ${raw}`)
}

/** Machine-readable versions stay numeric in DEV and PROD.
 * Tampermonkey and Chrome require orderable versions, so the human-facing
 * DEV prefix has a separate representation. */
export function channelVersion(version: string, _channel: ReleaseChannel): string {
  parseVersion(version)
  return version
}

export function chromeVersion(version: string, channel: ReleaseChannel): string {
  return channelVersion(version, channel)
}

export function devDisplayVersion(version: string, channel: ReleaseChannel): string {
  const numeric = channelVersion(version, channel)
  return channel === 'dev' ? `dev-${numeric}` : numeric
}

export function channelDisplayName(name: string, channel: ReleaseChannel): string {
  return channel === 'dev' ? `dev-${name}` : name
}

/** Preserve Tampermonkey's existing @name + @namespace installation identity.
 * Changing these fields during an automatic update can install a duplicate. */
export function userscriptChannelName(name: string, channel: ReleaseChannel): string {
  return channel === 'dev' ? `${name} [DEV]` : name
}

export function channelIdentity(id: string, channel: ReleaseChannel): string {
  if (!['vk-booster', 'chatgpt-booster', 'all-in-one'].includes(id))
    throw new Error('Unknown product identity')
  return `${id}:${channel}`
}

export function userscriptChannelUrl(id: string, channel: ReleaseChannel): string {
  if (!/^[a-z][a-z0-9-]+$/.test(id)) throw new Error('Invalid product')
  return (
    'https://raw.githubusercontent.com/KobaProduction/browser-extensions/' +
    channel +
    '/userscripts/' +
    id +
    '.user.js'
  )
}

export function channelModuleIds(
  changed: readonly string[],
  impacted: (paths: string[]) => string[],
): string[] {
  // Policy-only/docs-only changes cannot silently release a product.
  return impacted([...changed]).filter((id) => id !== 'proxy-switcher')
}
