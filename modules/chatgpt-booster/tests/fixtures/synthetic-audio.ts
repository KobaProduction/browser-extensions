/** No real audio or native browser permissions are used by lifecycle tests. */
export function installSyntheticAudio(unavailable = false) {
  const previous = globalThis.AudioContext
  const contexts: SyntheticAudioContext[] = []
  class SyntheticAudioContext {
    readonly currentTime = 0
    readonly destination = {}
    readonly frequencies: number[] = []
    closeCalls = 0
    constructor() {
      if (unavailable) throw Error('Synthetic audio permission denied')
      contexts.push(this)
    }
    createGain() {
      return {
        connect() {},
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      }
    }
    createOscillator() {
      const frequency = { value: 0 }
      return {
        type: 'sine',
        frequency,
        connect() {},
        start: () => this.frequencies.push(frequency.value),
        stop() {},
      }
    }
    async close() {
      this.closeCalls++
    }
  }
  Object.assign(globalThis, { AudioContext: SyntheticAudioContext })
  return {
    contexts,
    restore() {
      Object.assign(globalThis, { AudioContext: previous })
    },
  }
}
