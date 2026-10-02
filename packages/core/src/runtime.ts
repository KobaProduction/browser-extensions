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

  constructor(modules: BoosterModule[], onError: ModuleErrorHandler = defaultErrorHandler) {
    this.#modules = modules
    this.#onError = onError
  }

  async start(): Promise<void> {
    if (this.#started) return

    for (const module of this.#modules) {
      try {
        await module.start()
        this.#active.add(module)
      } catch (error) {
        this.#onError(module, error)
      }
    }

    this.#started = true
  }

  async stop(): Promise<void> {
    if (!this.#started) return

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
  }
}
