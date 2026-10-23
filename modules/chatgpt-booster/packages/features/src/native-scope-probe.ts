import type { NativeHistoryScope, NativeModules } from './native-history-reader'

/** A bounded hook probe; never creates a native scope or retains a global wrapper. */
export function probeNativeScope(
  react: NativeModules['react'],
  appToken: unknown,
  capture: (scope: NativeHistoryScope) => void,
  timeoutMs: number,
  expired: () => void = () => undefined,
) {
  const original = react.useRef
  let active = true
  const dispose = () => {
    if (!active) return
    active = false
    clearTimeout(timer)
    if (react.useRef === wrapped) react.useRef = original
  }
  const wrapped: typeof original = function (this: unknown, ...args) {
    const ref = Reflect.apply(original, this, args)
    queueMicrotask(() => {
      if (!active) return
      const candidate = ref.current as NativeHistoryScope | null
      if (
        candidate?.scope !== appToken ||
        candidate?.node?.token !== appToken ||
        typeof candidate?.get !== 'function'
      )
        return
      dispose()
      capture(candidate)
    })
    return ref
  }
  const timer = setTimeout(() => {
    dispose()
    expired()
  }, timeoutMs)
  react.useRef = wrapped
  return dispose
}
