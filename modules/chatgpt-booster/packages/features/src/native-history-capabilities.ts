import type { NativeModules } from './native-history-reader'

const runtimePath = '/cdn/assets/633146.1c1c050e67.js'
type CachedRuntime = { c: Record<string, { exports: Record<string, unknown> } | undefined> }

/** Only the already-loaded, source-inspected client may supply capabilities. */
export async function loadNativeHistoryCapabilities(): Promise<NativeModules> {
  const manifest = (window as unknown as { __reactRouterManifest?: { entry?: { imports?: string[] } } })
    .__reactRouterManifest
  if (!manifest?.entry?.imports?.includes(runtimePath)) throw Error('Unsupported native history runtime')
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
  return {
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
    userToken: cached('Cslg')?.i,
    pagination: {
      token: paginationToken,
      readPage: readPage as NonNullable<NativeModules['pagination']>['readPage'],
      flush: flush as NonNullable<NativeModules['pagination']>['flush'],
    },
  }
}
