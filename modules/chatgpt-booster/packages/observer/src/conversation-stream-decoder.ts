type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : null
function fullSourceEnvelope(value: ObjectValue): boolean {
  const message =
    object(value.message) ?? (value.type === 'input_message' ? object(value.input_message) : null)
  const author = object(message?.author),
    content = object(message?.content)
  return (
    typeof message?.id === 'string' &&
    !!message.id.trim() &&
    typeof author?.role === 'string' &&
    !!author.role.trim() &&
    typeof content?.content_type === 'string' &&
    !!content.content_type.trim()
  )
}

interface NativeDelta {
  channel: number
  path: string
  op: string
  value?: unknown
}
const forbidden = (key: string) => ['__proto__', 'constructor', 'prototype'].includes(key)
const field = (value: ObjectValue, short: string, long: string) =>
  Object.hasOwn(value, short) ? value[short] : value[long]

/** Native v1 (public client sY DeltaPayloadDecoder): c/p/o inherit from the
 * previous TOP-LEVEL delta, across channels. Inner patches only expand aliases;
 * their paths are relative to the patched value. Non-delta SSE controls bypass
 * that state. Originals remain separate evidence, never derived from the DOM. */
function applyNativeDelta(baseline: unknown, delta: ObjectValue, depth = 0): unknown {
  if (depth > 100) throw Error('Native delta nesting exceeds supported depth')
  const op = field(delta, 'o', 'op'),
    path = field(delta, 'p', 'path') ?? ''
  const replacement = field(delta, 'v', 'value')
  if (
    typeof path !== 'string' ||
    path.length > 1024 ||
    !['add', 'replace', 'append', 'remove', 'patch', 'truncate'].includes(String(op))
  )
    throw Error('Unsupported native delta operation')
  if (op !== 'remove' && !Object.hasOwn(delta, 'v') && !Object.hasOwn(delta, 'value'))
    throw Error('Native delta value missing')
  const keys =
    path === ''
      ? []
      : (path.startsWith('/') ? path.slice(1) : path).split('/').map((key) => {
          if (/~(?![01])/.test(key)) throw Error('Invalid native delta pointer')
          return key.replace(/~1/g, '/').replace(/~0/g, '~')
        })
  if (keys.some(forbidden)) throw Error('Unsafe native delta pointer')
  const root: ObjectValue = { value: baseline }
  let parent: ObjectValue | unknown[] = root
  let key = 'value'
  for (const nextKey of keys) {
    let next = (parent as ObjectValue)[key]
    if (next === undefined) {
      next = /^(0|[1-9]\d*)$/.test(nextKey) ? [] : {}
      ;(parent as ObjectValue)[key] = next
    }
    if (!next || typeof next !== 'object') throw Error('Invalid native delta parent')
    parent = next as ObjectValue | unknown[]
    key = nextKey
    if (Array.isArray(parent) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) > parent.length))
      throw Error('Invalid native delta array index')
  }
  const target = parent as ObjectValue,
    current = target[key]
  if (op === 'patch') {
    if (!Array.isArray(replacement)) throw Error('Invalid native patch list')
    let next = current
    for (const item of replacement) {
      const patch = object(item)
      if (!patch) throw Error('Invalid native patch')
      next = applyNativeDelta(next, patch, depth + 1)
    }
    target[key] = next
  } else if (op === 'append') {
    if (typeof current === 'string') {
      if (typeof replacement !== 'string') throw Error('Invalid native text append')
      target[key] = current + replacement
    } else if (Array.isArray(current)) {
      current.push(...structuredClone(Array.isArray(replacement) ? replacement : [replacement]))
    } else if (object(current) && object(replacement)) {
      const destination = current as ObjectValue,
        addition = replacement as ObjectValue
      for (const name of Object.keys(addition)) {
        if (forbidden(name)) throw Error('Unsafe native object append')
        destination[name] = structuredClone(addition[name])
      }
    } else target[key] = structuredClone(replacement)
  } else if (op === 'truncate') {
    if (
      !Number.isSafeInteger(replacement) ||
      Number(replacement) < 0 ||
      (typeof current !== 'string' && !Array.isArray(current)) ||
      Number(replacement) > current.length
    )
      throw Error('Invalid native truncate')
    if (typeof current === 'string') target[key] = current.substring(0, Number(replacement))
    else current.length = Number(replacement)
  } else if (op === 'remove') {
    if (!Object.hasOwn(target, key)) throw Error('Missing native delta removal target')
    if (Array.isArray(parent)) parent.splice(Number(key), 1)
    else delete target[key]
  } else if (Array.isArray(parent) && op === 'add')
    parent.splice(Number(key), 0, structuredClone(replacement))
  else target[key] = structuredClone(replacement)
  return root.value
}

/** Applies only explicit source patch paths to a captured baseline. Unknown
 * envelopes never become fabricated messages or renderer-derived content. */
export class ConversationStreamDecoder {
  private baseline: ObjectValue | null = null
  private poisoned = false
  private gapEvidence: ObjectValue[] = []
  private deltaEncoding: string | null = null
  private previousDelta: NativeDelta = { channel: 0, op: 'add', path: '' }
  private channelBaselines = new Map<number, ObjectValue>()
  private poisonedChannels = new Set<number>()
  hasGap() {
    return this.poisoned || this.poisonedChannels.size > 0
  }
  markGap(input: unknown) {
    this.poisoned = true
    this.gapEvidence.push({ kind: 'source_patch_gap', source: structuredClone(input) })
  }
  takeGapEvidence(): ObjectValue[] {
    const evidence = this.gapEvidence
    this.gapEvidence = []
    return evidence
  }
  retainedBaseline(): ObjectValue | null {
    if (this.deltaEncoding === 'v1') {
      const baseline = this.channelBaselines.get(this.previousDelta.channel)
      return baseline ? structuredClone(baseline) : null
    }
    return this.baseline ? structuredClone(this.baseline) : null
  }

  decode(
    input: unknown,
    eventType?: string | null,
  ): { payload: ObjectValue; evidence: ObjectValue } | null {
    if (eventType === 'delta_encoding') {
      this.deltaEncoding = typeof input === 'string' ? input : 'unsupported'
      if (input !== 'v1') this.markGap({ event: eventType, source: input })
      else {
        this.previousDelta = { channel: 0, op: 'add', path: '' }
        this.channelBaselines.clear()
        this.poisonedChannels.clear()
        this.poisoned = false
      }
      return null
    }
    if (eventType === 'delta') return this.decodeNativeDelta(input)
    if (this.deltaEncoding !== null) {
      // Native non-delta controls (including input_message) never participate
      // in the compressed delta inheritance or per-channel source baselines.
      const value = object(input)
      if (
        value &&
        (object(value.message) || value.type === 'input_message') &&
        !fullSourceEnvelope(value)
      ) {
        this.markGap({ event: eventType ?? null, source: input })
        return null
      }
      return value ? { payload: value, evidence: value } : null
    }
    const value = object(input)
    if (!value) {
      if (typeof input === 'string' || Array.isArray(input)) this.markGap(input)
      return null
    }
    // Control packets have their own protocol fields. In particular safety review's
    // `message` is a status string, not a native conversation message baseline.
    if (
      [
        'safety_review_update',
        'conversation_async_status',
        'main_stream_complete',
        'message_stream_complete',
      ].includes(String(value.type))
    )
      return { payload: value, evidence: value }
    if (Object.hasOwn(value, 'message') || value.type === 'input_message') {
      if (!fullSourceEnvelope(value)) {
        this.markGap(input)
        return null
      }
      this.poisoned = false
      this.baseline = structuredClone(value)
      return { payload: value, evidence: value }
    }
    const nativePatch =
      typeof value.o === 'string' && (typeof value.p === 'string' || value.o === 'patch')
    const patches = Array.isArray(value.patches)
      ? value.patches
      : value.o === 'patch' && Array.isArray(value.v)
        ? value.v
        : nativePatch
          ? [value]
          : null
    const root = object(value.v)
    if (
      root &&
      (value.p === '' || value.p === undefined) &&
      (value.o === undefined || value.o === 'add' || value.o === 'replace')
    ) {
      if (!fullSourceEnvelope(root)) {
        this.markGap(input)
        return null
      }
      this.baseline = structuredClone(root)
      this.poisoned = false
      return { payload: this.baseline, evidence: value }
    }
    if (!patches) {
      if (value.type === undefined && value.v !== undefined) {
        this.markGap(input)
        return null
      }
      return { payload: value, evidence: value }
    }
    const reject = () => {
      this.markGap(input)
      return null
    }
    if (this.poisoned) return reject()
    let next: unknown = this.baseline ? structuredClone(this.baseline) : null
    try {
      for (const candidate of patches) {
        const patch = object(candidate)
        if (!patch) return reject()
        const operation = patch.op ?? patch.o,
          path = patch.path ?? patch.p
        const replacement = Object.hasOwn(patch, 'value') ? patch.value : patch.v
        if (
          typeof path !== 'string' ||
          path.length > 1024 ||
          !['add', 'replace', 'append', 'remove'].includes(String(operation))
        )
          return reject()
        if (path === '') {
          if (operation !== 'add' && operation !== 'replace') return reject()
          next = structuredClone(replacement)
          continue
        }
        if (!path.startsWith('/') || !next) return reject()
        const keys = path
          .slice(1)
          .split('/')
          .map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'))
        if (keys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) return reject()
        let parent: unknown = next
        for (const key of keys.slice(0, -1)) {
          if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) return reject()
          parent = (parent as ObjectValue)[key]
        }
        if (!parent || typeof parent !== 'object') return reject()
        const target = parent as ObjectValue,
          key = keys.at(-1)
        if (key === undefined) return reject()
        if (
          Array.isArray(parent) &&
          key !== '-' &&
          (!/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) > parent.length ||
            (operation !== 'add' && Number(key) >= parent.length))
        )
          return reject()
        if (operation === 'append') {
          if (typeof target[key] === 'string' && typeof replacement === 'string')
            target[key] += replacement
          else if (Array.isArray(target[key]) && Array.isArray(replacement))
            target[key] = [...target[key], ...structuredClone(replacement)]
          else return reject()
        } else if (operation === 'remove') {
          if (!Object.hasOwn(target, key)) return reject()
          if (Array.isArray(parent)) parent.splice(Number(key), 1)
          else delete target[key]
        } else if (Array.isArray(parent) && operation === 'add')
          parent.splice(key === '-' ? parent.length : Number(key), 0, structuredClone(replacement))
        else {
          if (operation === 'replace' && !Object.hasOwn(target, key)) return reject()
          target[key] = structuredClone(replacement)
        }
      }
      const result = object(next)
      if (!result || !fullSourceEnvelope(result)) return reject()
      this.baseline = result
      return { payload: result, evidence: value }
    } catch {
      return reject()
    }
  }

  private decodeNativeDelta(input: unknown): { payload: ObjectValue; evidence: ObjectValue } | null {
    const value = object(input)
    const evidence = { event: 'delta', encoding: this.deltaEncoding, source: structuredClone(input) }
    if (this.deltaEncoding !== 'v1' || !value) {
      this.markGap(evidence)
      return null
    }
    const previous = this.previousDelta
    // The native codec fills the compact fields BEFORE expanding aliases, so
    // omitted c/p/o inherit even when a long-name property is also present.
    const inherited = (short: string, fallback: unknown) =>
      Object.hasOwn(value, short) ? value[short] : fallback
    const channel = inherited('c', previous.channel)
    const path = inherited('p', previous.path)
    const op = inherited('o', previous.op)
    if (
      !Number.isSafeInteger(channel) ||
      Number(channel) < 0 ||
      typeof path !== 'string' ||
      typeof op !== 'string'
    ) {
      this.markGap(evidence)
      return null
    }
    const delta: NativeDelta = {
      channel: Number(channel),
      path,
      op,
      ...(Object.hasOwn(value, 'v') || Object.hasOwn(value, 'value')
        ? { value: field(value, 'v', 'value') }
        : {}),
    }
    this.previousDelta = delta
    const reject = () => {
      this.poisonedChannels.add(delta.channel)
      this.gapEvidence.push({ kind: 'source_patch_gap', source: evidence })
      return null
    }
    const fullRoot = delta.path === '' && (delta.op === 'add' || delta.op === 'replace')
    if (this.poisoned || (this.poisonedChannels.has(delta.channel) && !fullRoot)) return reject()
    try {
      const baseline = this.channelBaselines.get(delta.channel)
      const next = applyNativeDelta(
        baseline ? structuredClone(baseline) : undefined,
        delta as unknown as ObjectValue,
      )
      if (next === undefined && delta.op === 'remove' && delta.path === '') {
        this.channelBaselines.delete(delta.channel)
        return null
      }
      const payload = object(next)
      if (
        !payload ||
        ((object(payload.message) || payload.type === 'input_message') && !fullSourceEnvelope(payload))
      )
        return reject()
      if (
        Object.hasOwn(payload, 'message') &&
        !object(payload.message) &&
        payload.type !== 'safety_review_update'
      )
        return reject()
      this.channelBaselines.set(delta.channel, payload)
      if (fullRoot) this.poisonedChannels.delete(delta.channel)
      return { payload: structuredClone(payload), evidence }
    } catch {
      return reject()
    }
  }
}
