import type { NativeModules } from './native-history-reader'

const accountRuntimePaths = ['/cdn/assets/633146.48b57020d2.js', '/cdn/assets/633146.4955a63526.js']
const runtimePaths = [...accountRuntimePaths, '/cdn/assets/633146.1c1c050e67.js']
type CachedRuntime = { c: Record<string, { exports: Record<string, unknown> } | undefined> }

export function nativeHistoryRouter() {
  return (
    window as unknown as {
      __reactRouterDataRouter?: {
        state?: { loaderData?: Record<string, { sidebarHistory?: { accountId?: unknown } }> }
        revalidate(): Promise<void> | void
        subscribe(callback: () => void): () => void
      }
    }
  ).__reactRouterDataRouter
}

/** Only the already-loaded, source-inspected client may supply capabilities. */
export async function loadNativeHistoryCapabilities(): Promise<NativeModules> {
  const manifest = (window as unknown as { __reactRouterManifest?: { entry?: { imports?: string[] } } })
    .__reactRouterManifest
  const runtimePath = runtimePaths.find((path) => manifest?.entry?.imports?.includes(path))
  if (!runtimePath) throw Error('Unsupported native history runtime')
  const supportsAccount = accountRuntimePaths.includes(runtimePath)
  // This URL is an already-loaded, source-inspected runtime, not a private API request.
  const moduleUrl = new URL(runtimePath, location.origin).href
  const runtime = (await import(/* @vite-ignore */ moduleUrl)).__webpack_require__ as CachedRuntime
  const cached = (id: string) => runtime.c[id]?.exports
  const react = cached('zd8w') as unknown as NativeModules['react']
  const history = cached('hwXH')?.a
  const readPage = cached('jfiJ')?.b,
    paginationToken = cached('FGJH')?.c,
    flush = cached('v7qY')?.flushSync
  if (
    typeof react?.useRef !== 'function' ||
    typeof history !== 'function' ||
    !cached('OWtl') ||
    !cached('OiCI') ||
    !cached('Cslg') ||
    typeof readPage !== 'function' ||
    !paginationToken ||
    typeof flush !== 'function'
  )
    throw Error('Native history not ready')
  const refreshAccount = cached('Ietk')?.c
  const userToken = cached('Cslg')?.[supportsAccount ? 'j' : 'i']
  if (!userToken) throw Error('Native history not ready')
  return {
    ...(supportsAccount
      ? { initialHistory: history as NonNullable<NativeModules['initialHistory']> }
      : {}),
    ...(supportsAccount && typeof refreshAccount === 'function'
      ? { refreshAccount: refreshAccount as NativeModules['refreshAccount'] }
      : {}),
    ...(cached('p0Ph')
      ? {
          delivery: {
            status: cached('p0Ph')?.G,
            error: cached('p0Ph')?.p,
            head: cached('p0Ph')?.o,
          },
        }
      : {}),
    react,
    history: history as NativeModules['history'],
    appToken: cached('OWtl')?.a,
    accountToken: cached('OiCI')?.a,
    userToken,
    pagination: {
      token: paginationToken,
      readPage: readPage as NonNullable<NativeModules['pagination']>['readPage'],
      flush: flush as NonNullable<NativeModules['pagination']>['flush'],
    },
  }
}
