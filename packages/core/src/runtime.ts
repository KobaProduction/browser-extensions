export interface BoosterModule {
  readonly id: string
  start(): void | Promise<void>
  stop(): void | Promise<void>
}

export class BoosterRuntime {
  readonly #modules: BoosterModule[]
  #started = false

  constructor(modules: BoosterModule[]) {
    this.#modules = modules
  }

  async start(): Promise<void> {
    if (this.#started) return

    for (const module of this.#modules) {
      await module.start()
    }

    this.#started = true
  }

  async stop(): Promise<void> {
    if (!this.#started) return

    for (const module of [...this.#modules].reverse()) {
      await module.stop()
    }

    this.#started = false
  }
}
