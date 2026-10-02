export interface BoosterSettings {
  enabled: boolean
}

export const DEFAULT_SETTINGS: BoosterSettings = {
  enabled: true,
}

export interface SettingsAdapter {
  get(): Promise<BoosterSettings>
  set(settings: BoosterSettings): Promise<void>
  subscribe(listener: (settings: BoosterSettings) => void): () => void
}
