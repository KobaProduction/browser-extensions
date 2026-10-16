import { readFile } from 'node:fs/promises'
import allInOne from '../apps/all-in-one.json' with { type: 'json' }
export interface ModuleManifest {
  id: string
  name: string
  version: string
  hosts?: string[]
  targets?: string[]
  capabilities?: string[]
  release: boolean
  dependencies?: string[]
}
export const DIST = 'dist'
export const KNOWN_MODULES = ['vk-booster', 'chatgpt-booster', 'proxy-switcher', 'all-in-one'] as const
export type ModuleId = (typeof KNOWN_MODULES)[number]
/** Delivery composition participates in the same consumer graph as provider
 * code. Keep shared entry helpers here so standalone builds cannot miss them. */
const PRODUCT_APP_SOURCES: Record<string, readonly string[]> = {
  'vk-booster': [
    'apps/userscript/src/vk-booster.ts',
    'apps/userscript/src/runtime.ts',
    'apps/extension/src/content.ts',
    'apps/extension/src/popup.ts',
    'apps/extension/src/popup.html',
    'apps/extension/src/manifest.json',
    'apps/extension/src/shared-background.ts',
    'apps/extension/src/telemetry-background.ts',
  ],
  'chatgpt-booster': [
    'apps/userscript/src/chatgpt-booster.ts',
    'apps/userscript/src/chatgpt-standalone.ts',
    'apps/userscript/src/runtime.ts',
    'apps/extension/src/chatgpt-content.ts',
    'apps/extension/src/chatgpt-standalone.ts',
    'apps/extension/src/chatgpt-background.ts',
    'apps/extension/src/telemetry-background.ts',
  ],
  'all-in-one': [
    'apps/all-in-one.json',
    'apps/userscript/src/all-in-one.ts',
    'apps/userscript/src/runtime.ts',
    'apps/extension/src/all-in-one-content.ts',
    'apps/extension/src/all-in-one-popup.ts',
    'apps/extension/src/popup.html',
    'apps/extension/src/manifest.json',
    'apps/extension/src/telemetry-background.ts',
  ],
}
export async function manifest(id: string): Promise<ModuleManifest> {
  const path = id === 'all-in-one' ? 'apps/all-in-one.json' : `modules/${id}/module.json`
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8')) as ModuleManifest
}
export function scopeFor(id: string): string[] {
  const shared = ['packages/', 'scripts/', 'package.json', 'bun.lock']
  return id === 'all-in-one'
    ? ['apps/', ...allInOne.dependencies.map((dependency) => `modules/${dependency}/`), ...shared]
    : [`modules/${id}/`, ...(PRODUCT_APP_SOURCES[id] ?? []), ...shared]
}
/** Only product-owned sources should bump product semver. Changes to shared
 * implementation code affect all direct consumers; docs/CI alone never do. */
export function impactedProductVersions(paths: readonly string[]): string[] {
  const appChanged = (id: string) => paths.some((path) => PRODUCT_APP_SOURCES[id]?.includes(path))
  const shared = paths.some(
    (path) =>
      path.startsWith('packages/') ||
      path === 'tsconfig.json' ||
      path === 'bun.lock' ||
      path === 'package.json' ||
      path === 'scripts/build.ts',
  )
  const vk =
    shared || paths.some((path) => path.startsWith('modules/vk-booster/')) || appChanged('vk-booster')
  const chatgpt =
    shared ||
    appChanged('chatgpt-booster') ||
    paths.some(
      (path) => path.startsWith('modules/chatgpt-booster/') || path === 'scripts/build-chatgpt.ts',
    )
  const aggregator =
    shared ||
    appChanged('all-in-one') ||
    (vk && allInOne.dependencies.includes('vk-booster')) ||
    (chatgpt && allInOne.dependencies.includes('chatgpt-booster'))
  return ['vk-booster', 'chatgpt-booster', 'all-in-one'].filter((id) =>
    id === 'vk-booster' ? vk : id === 'chatgpt-booster' ? chatgpt : aggregator,
  )
}
/** Build impact includes catalog, tooling and manifest changes; product
 * version impact above is intentionally narrower to avoid unrelated bumps. */
export function affectedModules(paths: string[]): ModuleId[] {
  const universal = paths.some((p) =>
    /^(packages\/|scripts\/|package\.json$|bun\.lock$|tsconfig\.json$|\.github\/)/.test(p),
  )
  const impacted = impactedProductVersions(paths)
  const proxy = paths.some((path) => path.startsWith('modules/proxy-switcher/'))
  return KNOWN_MODULES.filter(
    (id) => universal || impacted.includes(id) || (id === 'proxy-switcher' && proxy),
  )
}

// Legacy name retained for older tooling; release channel is selected by build.
export { userscriptChannelUrl } from './channels'
