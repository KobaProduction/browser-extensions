/** Evidence returned by an explicitly bound native account-registry method, never a page event. */
export interface ChatGptNativeAccountRegistry {
  selectedAccountId: string
  accountIds: readonly string[]
}
export interface ChatGptNativeAccountSource {
  read(signal: AbortSignal): Promise<ChatGptNativeAccountRegistry>
}
interface NativeAccountConsumer {
  begin(): unknown
  accept(registry: ChatGptNativeAccountRegistry, ticket: unknown): void
}
const consumers = new WeakMap<object, NativeAccountConsumer>()
const bindings = new WeakMap<object, { controller: AbortController }>()

/** Observer-private composition seam. No page global or message can supply registry evidence. */
export function registerNativeAccountConsumer(target: object, consumer: NativeAccountConsumer) {
  consumers.set(target, consumer)
  return () => {
    if (consumers.get(target) !== consumer) return
    consumers.delete(target)
    bindings.get(target)?.controller.abort()
    bindings.delete(target)
  }
}

/** Works only in the same composition as the installed observer. Separate worlds need a HAL port. */
export function bindNativeAccountSource(target: object, source: ChatGptNativeAccountSource) {
  const consumer = consumers.get(target)
  if (!consumer || typeof source?.read !== 'function') throw Error('automation.nativeMethodUnavailable')
  bindings.get(target)?.controller.abort()
  const registration = { controller: new AbortController() }
  bindings.set(target, registration)
  let revision = 0
  let activeRead: AbortController | undefined
  return {
    async refresh(signal?: AbortSignal) {
      activeRead?.abort()
      const readController = new AbortController()
      activeRead = readController
      const attempt = ++revision
      const combined = AbortSignal.any([
        registration.controller.signal,
        readController.signal,
        ...(signal ? [signal] : []),
      ])
      const assertActive = () => {
        if (
          combined.aborted ||
          consumers.get(target) !== consumer ||
          bindings.get(target) !== registration ||
          attempt !== revision
        )
          throw Error('automation.commandCancelled')
      }
      assertActive()
      const ticket = consumer.begin()
      const registry = await new Promise<ChatGptNativeAccountRegistry>((resolve, reject) => {
        const abort = () => reject(Error('automation.commandCancelled'))
        combined.addEventListener('abort', abort, { once: true })
        // A host method that ignores AbortSignal still cannot keep an activation alive.
        Promise.resolve()
          .then(() => {
            assertActive()
            return source.read(combined)
          })
          .then(
            (value) => {
              combined.removeEventListener('abort', abort)
              resolve(value)
            },
            (error) => {
              combined.removeEventListener('abort', abort)
              reject(error)
            },
          )
      })
      assertActive()
      if (
        !registry ||
        typeof registry.selectedAccountId !== 'string' ||
        !registry.selectedAccountId ||
        !Array.isArray(registry.accountIds) ||
        registry.accountIds.some((id) => typeof id !== 'string' || !id) ||
        !registry.accountIds.includes(registry.selectedAccountId)
      )
        throw Error('automation.nativeMethodUnavailable')
      consumer.accept(registry, ticket)
    },
    dispose() {
      registration.controller.abort()
      if (bindings.get(target) === registration) bindings.delete(target)
    },
  }
}
