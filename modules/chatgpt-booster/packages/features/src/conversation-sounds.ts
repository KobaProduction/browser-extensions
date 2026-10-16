import type { BoosterModule, BoosterSettings, SettingsAdapter } from '@chatgpt-booster/core'
import { instanceKey } from '@kobaproduction/browser-core'
import { claimSessionAlert } from './conversation-alerts'
import type { ConversationLifecycleSnapshot, ConversationStateStore } from './conversation-state'

type Tone = BoosterSettings['alerts']['sendTone']
function runIdentity(lifecycle: ConversationLifecycleSnapshot) {
  return lifecycle.requestId ?? [lifecycle.userMessageId, lifecycle.startedAt].join(':')
}
export interface ConversationTonePlayback {
  stop(): void
}
export function playConversationTone(
  tone: Tone,
  ending = false,
  onEnded?: () => void,
): ConversationTonePlayback | undefined {
  let audio: AudioContext | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    if (timeout !== undefined) clearTimeout(timeout)
    try {
      void audio?.close().catch(() => undefined)
    } catch {
      /* An unavailable audio context must not block teardown. */
    }
    onEnded?.()
  }
  try {
    const context = new AudioContext()
    audio = context
    const gain = context.createGain()
    gain.connect(context.destination)
    const melody = tone === 'soft' ? [520] : tone === 'chime' ? [660, 880] : [880, 660, 440]
    const notes = ending
      ? Array.from({ length: 12 }, (_, index) => {
          const note = melody[index % melody.length]
          if (note === undefined) throw Error('Sound melody unavailable')
          return note
        })
      : melody
    const spacing = ending ? 0.2 : 0.16
    const now = context.currentTime
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      oscillator.connect(gain)
      const start = now + index * spacing
      oscillator.start(start)
      oscillator.stop(start + (ending ? 0.22 : 0.1))
    })
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + notes.length * spacing + 0.22)
    timeout = setTimeout(stop, notes.length * spacing * 1000 + 500)
    return { stop }
  } catch {
    stop()
    /* Audio permissions are optional; capture/lifecycle always continue. */
    return undefined
  }
}

/** Optional sound module. Only request/API/stream evidence can emit a sound. */
export class ConversationSoundsModule implements BoosterModule {
  readonly id = 'conversation-sounds'
  private settings: BoosterSettings | undefined
  private unsubscribeSettings: (() => void) | undefined
  private unsubscribeState: (() => void) | undefined
  private unsubscribeAccount: (() => void) | undefined
  private ticker: ReturnType<typeof setInterval> | undefined
  private runs = new Map<string, ConversationLifecycleSnapshot>()
  private prolonged = new Set<string>()
  private claimed = new Set<string>()
  private readonly playing = new Set<ConversationTonePlayback>()
  private active = false
  private generation = 0
  constructor(
    private readonly adapter: SettingsAdapter,
    private readonly state: ConversationStateStore,
  ) {}
  private play(tone: Tone, ending = false) {
    let playback: ConversationTonePlayback | undefined
    playback = playConversationTone(tone, ending, () => {
      if (playback) this.playing.delete(playback)
    })
    if (playback) this.playing.add(playback)
  }
  private silence() {
    for (const playback of this.playing) playback.stop()
    this.playing.clear()
  }
  async start() {
    if (this.active || typeof window === 'undefined' || window.location.hostname !== 'chatgpt.com')
      return
    this.active = true
    const generation = ++this.generation
    let settings: BoosterSettings
    try {
      settings = await this.adapter.get()
    } catch (error) {
      if (generation === this.generation) this.active = false
      throw error
    }
    if (!this.active || generation !== this.generation) return
    this.settings = settings
    this.unsubscribeSettings = this.adapter.subscribe((settings) => {
      this.settings = settings
      if (!settings.enabled || !settings.alerts.enabled) this.silence()
    })
    this.unsubscribeAccount = this.state.subscribeAccount(() => {
      this.silence()
      this.runs.clear()
      this.prolonged.clear()
      this.claimed.clear()
    })
    this.unsubscribeState = this.state.subscribe((change) => {
      const lifecycle = this.state.lifecycle(change.conversationId)
      if (!lifecycle) return
      const previous = this.runs.get(change.conversationId)
      this.runs.set(change.conversationId, lifecycle)
      const settings = this.settings
      const ownerId = this.state.verifiedAccountId()
      if (!settings?.enabled || !lifecycle.userMessageId || !ownerId) return
      const sound = settings.alerts
      const run = instanceKey(
        ['chatgpt-sound', ownerId, change.conversationId, runIdentity(lifecycle)].join(':'),
      )
      const claim = (kind: string) => {
        const key = `${run}:${kind}`
        if (this.claimed.has(key)) return false
        this.claimed.add(key)
        if (this.claimed.size > 512) {
          const oldest = this.claimed.values().next().value
          if (oldest !== undefined) this.claimed.delete(oldest)
        }
        try {
          return claimSessionAlert(window.sessionStorage, key)
        } catch {
          return true
        }
      }
      if (
        change.reason === 'request' &&
        lifecycle.source === 'request' &&
        claim('sent') &&
        sound.enabled &&
        sound.userSendSound
      )
        this.play(sound.sendTone)
      const wasActive =
        previous !== undefined &&
        runIdentity(previous) === runIdentity(lifecycle) &&
        ['in_progress', 'stop_requested'].includes(previous.state)
      if (lifecycle.source !== 'transport') return
      if (lifecycle.terminalCause === 'conversation_too_large' && claim('exhausted')) {
        if (sound.enabled && sound.conversationEndSound) this.play(sound.endTone, true)
      } else if (
        wasActive &&
        lifecycle.state === 'complete' &&
        lifecycle.terminalCause === null &&
        claim('complete')
      ) {
        if (sound.enabled && sound.responseCompleteSound) this.play(sound.completeTone)
      }
    })
    this.ticker = setInterval(() => {
      const settings = this.settings
      if (!settings?.enabled || !settings.alerts.enabled || !settings.alerts.longRunningSound) return
      for (const [id, lifecycle] of this.runs) {
        const key = `${id}:${runIdentity(lifecycle)}`
        if (
          lifecycle.state === 'in_progress' &&
          lifecycle.startedAt &&
          !this.prolonged.has(key) &&
          Date.now() - lifecycle.startedAt >= settings.alerts.longRunningThresholdMs
        ) {
          this.prolonged.add(key)
          this.play('soft')
        }
      }
    }, 1000)
  }
  stop() {
    this.active = false
    this.generation++
    this.unsubscribeSettings?.()
    this.unsubscribeState?.()
    this.unsubscribeAccount?.()
    this.unsubscribeSettings = undefined
    this.unsubscribeState = undefined
    this.unsubscribeAccount = undefined
    if (this.ticker !== undefined) clearInterval(this.ticker)
    this.ticker = undefined
    this.settings = undefined
    this.silence()
    this.runs.clear()
    this.prolonged.clear()
    this.claimed.clear()
  }
}
