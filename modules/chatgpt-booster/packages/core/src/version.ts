declare const __BOOSTER_BUILD_SHA__: string | undefined
declare const __BOOSTER_BUILD_VERSION__: string | undefined

export const BOOSTER_BASE_VERSION = '2.0.6'
const injectedSha = typeof __BOOSTER_BUILD_SHA__ === 'string' ? __BOOSTER_BUILD_SHA__.trim() : ''
const injectedVersion =
  typeof __BOOSTER_BUILD_VERSION__ === 'string' ? __BOOSTER_BUILD_VERSION__.trim() : ''
export const BOOSTER_BUILD_SHA = injectedSha
export const BOOSTER_BUILD_VERSION = injectedVersion || BOOSTER_BASE_VERSION
export const BOOSTER_VERSION = BOOSTER_BUILD_VERSION
