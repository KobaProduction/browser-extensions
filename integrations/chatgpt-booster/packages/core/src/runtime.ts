export interface BoosterModule {
  readonly id: string
  start(): void | Promise<void>
  stop(): void | Promise<void>
}

export type ModuleErrorHandler = (module: BoosterModule, error: unknown) => void

function defaultErrorHandler(module: BoosterModule, error: unknown) {
  console.error('[ChatGPT Booster] Module failed:', module.id, error)
}

export class BoosterRuntime {
  readonly #modules: BoosterModule[]
  readonly #active = new Set<BoosterModule>()
  readonly #onError: ModuleErrorHandler
  #started = false
  #startPromise: Promise<void> | undefined
  #stopPromise: Promise<void> | undefined

  constructor(modules: BoosterModule[], onError: ModuleErrorHandler = defaultErrorHandler) {
    this.#modules = modules
    this.#onError = onError
  }

  async start(): Promise<void> {
    if (this.#started) return
    if (this.#startPromise) return await this.#startPromise
    if (this.#stopPromise) await this.#stopPromise
    if (this.#started) return

    const pending = Promise.all(
      this.#modules.map(async (module) => {
        try {
          await module.start()
          this.#active.add(module)
        } catch (error) {
          this.#onError(module, error)
        }
      }),
    ).then(() => {
      this.#started = true
    })

    this.#startPromise = pending
    try {
      await pending
    } finally {
      if (this.#startPromise === pending) this.#startPromise = undefined
    }
  }

  async stop(): Promise<void> {
    if (this.#stopPromise) return await this.#stopPromise
    if (this.#startPromise) await this.#startPromise
    if (!this.#started && this.#active.size === 0) return

    const pending = (async () => {
      for (const module of [...this.#modules].reverse()) {
        if (!this.#active.has(module)) continue

        try {
          await module.stop()
        } catch (error) {
          this.#onError(module, error)
        }
      }

      this.#active.clear()
      this.#started = false
    })()

    this.#stopPromise = pending
    try {
      await pending
    } finally {
      if (this.#stopPromise === pending) this.#stopPromise = undefined
    }
  }
}
