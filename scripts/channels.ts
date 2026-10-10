/** Distribution channels are independent of immutable source/product versions. */
export type ReleaseChannel = 'dev' | 'prod'

export function releaseChannel(raw: string | undefined): ReleaseChannel {
  if (!raw || raw === 'prod') return 'prod'
  if (raw === 'dev') return 'dev'
  throw new Error('Unknown release channel: ' + raw)
}

export function channelVersion(version: string, channel: ReleaseChannel, run: number): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid source semver')
  if (channel === 'prod') return version
  if (!Number.isSafeInteger(run) || run < 1 || run > 65535)
    throw new Error('Development release counter must be between 1 and 65535')
  return version + '-dev.' + run
}

export function chromeVersion(version: string, channel: ReleaseChannel, run: number): string {
  const result = channelVersion(version, channel, run)
  return channel === 'dev' ? result.replace('-dev.', '.') : result
}

export function channelIdentity(id: string, channel: ReleaseChannel): string {
  if (!['vk-booster', 'chatgpt-booster', 'all-in-one'].includes(id))
    throw new Error('Unknown product identity')
  return id + ':' + channel
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
