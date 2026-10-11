import { assertServiceScope, type PersistentSettingsPort, type ServiceScope } from './service-contract'

/** Structural Pinia adapter: caller explicitly picks portable public fields. */
export interface PiniaPortableStore<State extends object> {
  readonly $state: State
  $patch(mutation: (state: State) => void): void
}
export interface PiniaBackupOptions<State extends object, Portable> {
  readonly scope: ServiceScope
  readonly schemaVersion: number
  readonly store: PiniaPortableStore<State>
  /** Explicit allowlist: the whole Pinia state may contain credentials. */
  readonly pick: (state: Readonly<State>) => Portable
  readonly apply: (state: State, portable: Portable) => void
  readonly validate: (input: unknown) => Portable
  /** Persist through product/target-scoped storage (not tab sessionStorage). */
  readonly persist: (value: Portable) => Promise<void>
}

export function createPiniaBackupPort<State extends object, Portable>(
  options: PiniaBackupOptions<State, Portable>,
): PersistentSettingsPort<Portable> {
  assertServiceScope(options.scope)
  if (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion < 1)
    throw Error('Invalid Pinia backup schema version')
  return {
    scope: options.scope,
    schemaVersion: options.schemaVersion,
    async exportSettings() {
      return options.validate(options.pick(options.store.$state))
    },
    validateSettings: options.validate,
    async restoreSettingsAtomically(raw) {
      const next = options.validate(raw)
      const previous = options.validate(options.pick(options.store.$state))
      // Persist first: a failed storage write must not expose an uncommitted UI state.
      await options.persist(next)
      try {
        options.store.$patch((state) => options.apply(state, next))
      } catch (error) {
        try {
          await options.persist(previous)
          options.store.$patch((state) => options.apply(state, previous))
        } catch {
          throw Error('Pinia restore rollback failed; inspect persistent settings')
        }
        throw error
      }
    },
  }
}
