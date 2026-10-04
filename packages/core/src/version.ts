declare const __BOOSTER_BUILD_SHA__: string | undefined

export const BOOSTER_BASE_VERSION = '0.6.1'
const injectedSha = typeof __BOOSTER_BUILD_SHA__ === 'string' ? __BOOSTER_BUILD_SHA__.trim() : ''
export const BOOSTER_BUILD_SHA = injectedSha
export const BOOSTER_VERSION = injectedSha
  ? `${BOOSTER_BASE_VERSION}-g${injectedSha.slice(0, 8)}`
  : BOOSTER_BASE_VERSION
