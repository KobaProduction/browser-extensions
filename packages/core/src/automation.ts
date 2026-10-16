/** Shared in-memory automation. Providers own facts, native commands and consent. */
export type RemoteSessionMode = 'local-only' | 'local-and-remote' | 'remote-only'
export type TriggerCommandKind =
  | 'triggers-list'
  | 'triggers-get-config'
  | 'triggers-get'
  | 'triggers-get-unsaved'
  | 'triggers-draft-set'
  | 'triggers-draft-upsert'
  | 'triggers-draft-remove'
  | 'triggers-draft-reset'
  | 'triggers-draft-save'
  | 'triggers-draft-discard'
export type RemoteCommandKind =
  | 'send-message'
  | 'stop'
  | 'continue'
  | 'new-chat'
  | 'triggers-set'
  | 'triggers-reset'
  | 'archive-sync'
  | TriggerCommandKind
export interface RemoteSessionConfig {
  readonly enabled: boolean
  readonly mode: RemoteSessionMode
  readonly endpoint: string
  /** Local opt-in; the server must separately request raw event capability. */
  readonly rawEvents: boolean
  readonly allowedCommands: readonly RemoteCommandKind[]
  readonly queueLimit: number
  readonly inFlightLimit: number
  readonly maxAttempts: number
  readonly commandTtlMs: number
}
export const DEFAULT_REMOTE_SESSION_CONFIG: RemoteSessionConfig = Object.freeze({
  enabled: false,
  mode: 'local-only',
  endpoint: '',
  rawEvents: false,
  allowedCommands: Object.freeze([]),
  queueLimit: 10000,
  inFlightLimit: 8,
  maxAttempts: 8,
  commandTtlMs: 60000,
})
export type AutomationEventType = 'message' | 'api' | 'dom' | 'limit' | 'conflict' | 'completion'
export type AutomationOrigin = 'provider' | 'user' | 'automation' | 'remote'
export type AutomationCompletionOutcome = 'complete' | 'failed' | 'cancelled' | 'context-exhausted'
export interface AutomationEventContext {
  readonly eventId: string
  readonly providerId: string
  readonly runId: string
  readonly conversationId?: string
  readonly origin: AutomationOrigin
  readonly at: number
  /** Providers propagate this when native actions subsequently produce facts. */
  readonly cause?: { readonly commandId: string; readonly ruleId?: string }
}
/** Message text is private, ephemeral input; never an automatic telemetry payload. */
export type AutomationEvent = AutomationEventContext &
  (
    | {
        readonly type: 'message'
        readonly role: 'user' | 'assistant' | 'tool'
        readonly text: string
        readonly final: boolean
      }
    | { readonly type: 'api'; readonly name: string; readonly status?: 'start' | 'success' | 'error' }
    | { readonly type: 'dom'; readonly name: string; readonly value: boolean | string | number }
    | { readonly type: 'limit'; readonly name: string; readonly value?: number }
    | { readonly type: 'conflict'; readonly name: string }
    | { readonly type: 'completion'; readonly outcome: AutomationCompletionOutcome }
  )
export interface AutomationPattern {
  readonly kind: 'contains' | 'exact'
  readonly value: string
  readonly caseSensitive?: boolean
}
export interface AutomationTrigger {
  readonly type: AutomationEventType
  readonly name?: string
  readonly role?: 'user' | 'assistant' | 'tool'
  readonly outcome?: AutomationCompletionOutcome
  readonly pattern?: AutomationPattern
}
export type AutomationAction =
  | { readonly type: 'send-message'; readonly text: string }
  | { readonly type: 'stop' }
  | { readonly type: 'continue'; readonly text?: string }
  | { readonly type: 'new-chat'; readonly text?: string; readonly projectId?: string }
  | { readonly type: 'play-sound'; readonly tone: 'soft' | 'chime' | 'pulse' }
  | { readonly type: 'remote-event'; readonly name: string }
export interface AutomationRule {
  readonly id: string
  readonly label: string
  readonly enabled: boolean
  readonly trigger: AutomationTrigger
  readonly actions: readonly AutomationAction[]
  readonly cooldownMs: number
}
export interface AutomationConfiguration {
  readonly enabled: boolean
  readonly domEvents: boolean
  readonly rules: readonly AutomationRule[]
  readonly remote: RemoteSessionConfig
}
export const DEFAULT_AUTOMATION_CONFIGURATION: AutomationConfiguration = Object.freeze({
  enabled: false,
  domEvents: false,
  rules: Object.freeze([]),
  remote: DEFAULT_REMOTE_SESSION_CONFIG,
})
export interface RemoteCommandPayloadMap {
  'send-message': { readonly text: string }
  stop: Record<string, never>
  continue: { readonly text?: string }
  'new-chat': { readonly text?: string; readonly projectId?: string }
  'triggers-set': { readonly rules: readonly AutomationRule[] }
  'triggers-reset': Record<string, never>
  'archive-sync': Record<string, never>
  'triggers-list': Record<string, never>
  'triggers-get-config': Record<string, never>
  'triggers-get': { readonly id: string }
  'triggers-get-unsaved': Record<string, never>
  'triggers-draft-set': { readonly rules: readonly AutomationRule[] }
  'triggers-draft-upsert': { readonly rule: AutomationRule }
  'triggers-draft-remove': { readonly id: string }
  'triggers-draft-reset': Record<string, never>
  'triggers-draft-save': Record<string, never>
  'triggers-draft-discard': Record<string, never>
}
export type AutomationCommandAction =
  | AutomationAction
  | { readonly type: 'triggers-set'; readonly rules: readonly AutomationRule[] }
  | { readonly type: 'triggers-reset' }
  | { readonly type: 'archive-sync' }
export interface AutomationCommand {
  readonly commandId: string
  readonly providerId: string
  readonly runId: string
  readonly conversationId?: string
  readonly eventId?: string
  readonly ruleId?: string
  readonly origin: 'automation' | 'remote' | 'user'
  readonly at: number
  readonly action: AutomationCommandAction
}
export interface AutomationCommandResult {
  readonly status: 'executed' | 'ignored' | 'failed' | 'unsupported'
  readonly reason?:
    | 'disabled'
    | 'duplicate'
    | 'queue-limit'
    | 'configuration-changed'
    | 'remote-disabled'
    | 'unsupported'
    | 'handler-failed'
}
export interface AutomationDispatchResult {
  readonly accepted: boolean
  readonly matchedRules: number
  readonly scheduledCommands: number
}
export type AutomationEventListener = (event: AutomationEvent) => void | Promise<void>
export interface AutomationEventHub {
  publish(event: AutomationEvent): Promise<void>
  subscribe(listener: AutomationEventListener): () => void
}
export interface AutomationEngineOptions {
  readonly configuration?: AutomationConfiguration
  readonly handleCommand: (
    command: AutomationCommand,
  ) => void | AutomationCommandResult | Promise<void> | Promise<AutomationCommandResult | undefined>
  readonly now?: () => number
}
export interface AutomationEngine {
  readonly events: AutomationEventHub
  configuration(): AutomationConfiguration
  configure(input: unknown): void
  setEnabled(enabled: boolean): void
  upsertRule(rule: AutomationRule): void
  removeRule(id: string): void
  subscribeConfiguration(listener: (configuration: AutomationConfiguration) => void): () => void
  subscribeCommands(
    listener: (command: AutomationCommand, result: AutomationCommandResult) => void,
  ): () => void
  publish(event: AutomationEvent): Promise<AutomationDispatchResult>
  dispatch(command: AutomationCommand): Promise<AutomationCommandResult>
  dispose(): void
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const copy = <T>(value: T): T => structuredClone(value)
export const REMOTE_COMMAND_KINDS: readonly RemoteCommandKind[] = Object.freeze([
  'send-message',
  'stop',
  'continue',
  'new-chat',
  'triggers-set',
  'triggers-reset',
  'archive-sync',
  'triggers-list',
  'triggers-get-config',
  'triggers-get',
  'triggers-get-unsaved',
  'triggers-draft-set',
  'triggers-draft-upsert',
  'triggers-draft-remove',
  'triggers-draft-reset',
  'triggers-draft-save',
  'triggers-draft-discard',
])
const remoteKinds = REMOTE_COMMAND_KINDS
const eventTypes: readonly AutomationEventType[] = [
  'message',
  'api',
  'dom',
  'limit',
  'conflict',
  'completion',
]
const outcomes: readonly AutomationCompletionOutcome[] = [
  'complete',
  'failed',
  'cancelled',
  'context-exhausted',
]
function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!object(value) || Object.keys(value).some((key) => !keys.includes(key)))
    throw Error('Invalid automation configuration')
  return value
}
function text(value: unknown, max = 8192, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw Error('Invalid automation text')
  return value
}
function id(value: unknown): string {
  const result = text(value, 256)
  for (const character of result)
    if (character.charCodeAt(0) < 0x20) throw Error('Invalid automation identity')
  return result
}
function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw Error('Invalid automation flag')
  return value
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw Error('Invalid automation limit')
  return value
}
export function normalizeRemoteSessionConfig(
  input: unknown = DEFAULT_REMOTE_SESSION_CONFIG,
): RemoteSessionConfig {
  const value = shape(input, [
    'enabled',
    'mode',
    'endpoint',
    'rawEvents',
    'allowedCommands',
    'queueLimit',
    'inFlightLimit',
    'maxAttempts',
    'commandTtlMs',
  ])
  const mode = value.mode ?? 'local-only'
  if (typeof mode !== 'string' || !['local-only', 'local-and-remote', 'remote-only'].includes(mode))
    throw Error('Invalid remote session mode')
  const endpoint = value.endpoint === undefined ? '' : text(value.endpoint, 2048, true)
  if (endpoint) {
    const url = new URL(endpoint)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (
      (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error('Invalid remote WebSocket endpoint')
  }
  const commands = value.allowedCommands ?? []
  if (
    !Array.isArray(commands) ||
    commands.length > remoteKinds.length ||
    commands.some((kind) => !remoteKinds.includes(kind)) ||
    new Set(commands).size !== commands.length
  )
    throw Error('Invalid remote command capabilities')
  const enabled = bool(value.enabled, false)
  if (enabled && mode !== 'local-only' && !endpoint) throw Error('Remote session endpoint is required')
  return {
    enabled,
    mode: mode as RemoteSessionMode,
    endpoint,
    rawEvents: bool(value.rawEvents, false),
    allowedCommands: [...commands],
    queueLimit: integer(value.queueLimit, 10000, 1, 100000),
    inFlightLimit: integer(value.inFlightLimit, 8, 1, 32),
    maxAttempts: integer(value.maxAttempts, 8, 1, 32),
    commandTtlMs: integer(value.commandTtlMs, 60000, 1000, 86400000),
  }
}
function triggerOf(input: unknown): AutomationTrigger {
  const value = shape(input, ['type', 'name', 'role', 'outcome', 'pattern'])
  if (!eventTypes.includes(value.type as AutomationEventType)) throw Error('Invalid automation trigger')
  const result: {
    type: AutomationEventType
    name?: string
    role?: 'user' | 'assistant' | 'tool'
    outcome?: AutomationCompletionOutcome
    pattern?: AutomationPattern
  } = { type: value.type as AutomationEventType }
  if (value.name !== undefined) {
    if (!['api', 'dom', 'limit', 'conflict'].includes(result.type))
      throw Error('Trigger name is unsupported')
    result.name = text(value.name, 128)
  }
  if (value.role !== undefined) {
    if (
      result.type !== 'message' ||
      typeof value.role !== 'string' ||
      !['user', 'assistant', 'tool'].includes(value.role)
    )
      throw Error('Invalid trigger role')
    result.role = value.role as typeof result.role
  }
  if (value.outcome !== undefined) {
    if (result.type !== 'completion' || !outcomes.includes(value.outcome as AutomationCompletionOutcome))
      throw Error('Invalid completion trigger')
    result.outcome = value.outcome as AutomationCompletionOutcome
  }
  if (value.pattern !== undefined) {
    const pattern = shape(value.pattern, ['kind', 'value', 'caseSensitive'])
    if (result.type !== 'message' || (pattern.kind !== 'contains' && pattern.kind !== 'exact'))
      throw Error('Invalid message pattern')
    result.pattern = {
      kind: pattern.kind,
      value: text(pattern.value, 512),
      caseSensitive: bool(pattern.caseSensitive, false),
    }
  }
  return result
}
function actionOf(input: unknown): AutomationAction {
  if (!object(input) || typeof input.type !== 'string') throw Error('Invalid automation action')
  if (input.type === 'send-message') {
    const value = shape(input, ['type', 'text'])
    return { type: 'send-message', text: text(value.text) }
  }
  if (input.type === 'stop') {
    shape(input, ['type'])
    return { type: 'stop' }
  }
  if (input.type === 'continue' || input.type === 'new-chat') {
    const value = shape(
      input,
      input.type === 'new-chat' ? ['type', 'text', 'projectId'] : ['type', 'text'],
    )
    return {
      type: input.type,
      ...(value.text !== undefined ? { text: text(value.text) } : {}),
      ...(value.projectId !== undefined ? { projectId: id(value.projectId) } : {}),
    }
  }
  if (input.type === 'remote-event') {
    const value = shape(input, ['type', 'name'])
    return { type: 'remote-event', name: text(value.name, 128) }
  }
  if (input.type === 'play-sound') {
    const value = shape(input, ['type', 'tone'])
    if (value.tone !== 'soft' && value.tone !== 'chime' && value.tone !== 'pulse')
      throw Error('Invalid automation sound tone')
    return { type: 'play-sound', tone: value.tone }
  }
  throw Error('Unsupported automation action')
}
export function validateAutomationRule(input: unknown): AutomationRule {
  const value = shape(input, ['id', 'label', 'enabled', 'trigger', 'actions', 'cooldownMs'])
  if (!Array.isArray(value.actions) || !value.actions.length || value.actions.length > 8)
    throw Error('Invalid automation action count')
  const ruleId = text(value.id, 64)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(ruleId)) throw Error('Invalid automation rule identity')
  return {
    id: ruleId,
    label: text(value.label, 128),
    enabled: bool(value.enabled, false),
    trigger: triggerOf(value.trigger),
    actions: value.actions.map(actionOf),
    cooldownMs: integer(value.cooldownMs, 1000, 0, 86400000),
  }
}
export function validateAutomationRules(input: unknown): readonly AutomationRule[] {
  if (!Array.isArray(input) || input.length > 64) throw Error('Invalid automation rule count')
  const rules = input.map(validateAutomationRule)
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
    throw Error('Duplicate automation rules')
  return rules
}
const rulesOf = validateAutomationRules
export function normalizeAutomationConfiguration(
  input: unknown = DEFAULT_AUTOMATION_CONFIGURATION,
): AutomationConfiguration {
  const value = shape(input, ['enabled', 'domEvents', 'rules', 'remote'])
  return {
    enabled: bool(value.enabled, false),
    domEvents: bool(value.domEvents, false),
    rules: rulesOf(value.rules ?? []),
    remote: normalizeRemoteSessionConfig(value.remote),
  }
}
export function validateRemoteCommandPayload<K extends RemoteCommandKind>(
  kind: K,
  input: unknown,
): RemoteCommandPayloadMap[K] {
  if (!remoteKinds.includes(kind)) throw Error('Unsupported remote command')
  if (kind === 'triggers-set' || kind === 'triggers-draft-set') {
    const value = shape(input, ['rules'])
    return { rules: rulesOf(value.rules) } as RemoteCommandPayloadMap[K]
  }
  if (kind === 'triggers-get' || kind === 'triggers-draft-remove') {
    const value = shape(input, ['id'])
    return { id: id(value.id) } as RemoteCommandPayloadMap[K]
  }
  if (kind === 'triggers-draft-upsert') {
    const value = shape(input, ['rule'])
    return { rule: validateAutomationRule(value.rule) } as RemoteCommandPayloadMap[K]
  }
  if (
    kind === 'triggers-reset' ||
    kind === 'stop' ||
    kind === 'archive-sync' ||
    kind.startsWith('triggers-')
  ) {
    shape(input, [])
    return {} as RemoteCommandPayloadMap[K]
  }
  const value = actionOf({
    ...shape(input, kind === 'new-chat' ? ['text', 'projectId'] : ['text']),
    type: kind,
  })
  const { type: _type, ...payload } = value
  return payload as RemoteCommandPayloadMap[K]
}
function eventOf(input: AutomationEvent): AutomationEvent {
  const base = ['eventId', 'providerId', 'runId', 'conversationId', 'origin', 'at', 'cause', 'type']
  const fields: Record<AutomationEventType, readonly string[]> = {
    message: ['role', 'text', 'final'],
    api: ['name', 'status'],
    dom: ['name', 'value'],
    limit: ['name', 'value'],
    conflict: ['name'],
    completion: ['outcome'],
  }
  if (!object(input) || !eventTypes.includes(input.type)) throw Error('Invalid automation event')
  shape(input, [...base, ...fields[input.type]])
  id(input.eventId)
  id(input.providerId)
  id(input.runId)
  if (input.conversationId !== undefined) id(input.conversationId)
  if (
    !['provider', 'user', 'automation', 'remote'].includes(input.origin) ||
    !Number.isFinite(input.at) ||
    input.at < 0
  )
    throw Error('Invalid automation event context')
  if (input.cause !== undefined) {
    const cause = shape(input.cause, ['commandId', 'ruleId'])
    id(cause.commandId)
    if (cause.ruleId !== undefined) id(cause.ruleId)
  }
  if (input.type === 'message') {
    text(input.text, 1048576, true)
    if (!['user', 'assistant', 'tool'].includes(input.role) || typeof input.final !== 'boolean')
      throw Error('Invalid message fact')
  } else if (input.type === 'completion') {
    if (!outcomes.includes(input.outcome)) throw Error('Invalid completion fact')
  } else {
    text(input.name, 128)
    if (
      input.type === 'api' &&
      input.status !== undefined &&
      !['start', 'success', 'error'].includes(input.status)
    )
      throw Error('Invalid API fact')
    if (input.type === 'dom' && !['string', 'number', 'boolean'].includes(typeof input.value))
      throw Error('Invalid DOM fact')
    if (input.type === 'dom' && typeof input.value === 'string') text(input.value, 8192, true)
    if (input.type === 'limit' && input.value !== undefined && typeof input.value !== 'number')
      throw Error('Invalid limit fact')
    if (
      (input.type === 'limit' || input.type === 'dom') &&
      typeof input.value === 'number' &&
      !Number.isFinite(input.value)
    )
      throw Error('Invalid fact value')
  }
  return copy(input)
}
function commandOf(input: AutomationCommand): AutomationCommand {
  shape(input, [
    'commandId',
    'providerId',
    'runId',
    'conversationId',
    'eventId',
    'ruleId',
    'origin',
    'at',
    'action',
  ])
  id(input.commandId)
  id(input.providerId)
  id(input.runId)
  if (input.conversationId !== undefined) id(input.conversationId)
  if (input.eventId !== undefined) id(input.eventId)
  if (input.ruleId !== undefined) id(input.ruleId)
  if (
    !['automation', 'remote', 'user'].includes(input.origin) ||
    !Number.isFinite(input.at) ||
    input.at < 0
  )
    throw Error('Invalid command context')
  const action = input.action
  if (action.type === 'triggers-set') {
    shape(action, ['type', 'rules'])
    return { ...copy(input), action: { type: 'triggers-set', rules: rulesOf(action.rules) } }
  }
  if (action.type === 'triggers-reset' || action.type === 'archive-sync') {
    shape(action, ['type'])
    return { ...copy(input), action: { type: action.type } }
  }
  return { ...copy(input), action: actionOf(action) }
}
function notify<T>(listeners: ReadonlySet<(value: T) => unknown>, value: T) {
  for (const listener of [...listeners])
    try {
      void Promise.resolve(listener(copy(value))).catch(() => undefined)
    } catch {
      /* Observer failures do not turn a fact into a command. */
    }
}
export function createAutomationEventHub(): AutomationEventHub {
  const listeners = new Set<AutomationEventListener>()
  return {
    async publish(event) {
      notify(listeners, eventOf(event))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
function matches(trigger: AutomationTrigger, event: AutomationEvent) {
  if (trigger.type !== event.type) return false
  if (trigger.name !== undefined && (!('name' in event) || trigger.name !== event.name)) return false
  if (trigger.role !== undefined && (event.type !== 'message' || event.role !== trigger.role))
    return false
  if (
    trigger.outcome !== undefined &&
    (event.type !== 'completion' || event.outcome !== trigger.outcome)
  )
    return false
  if (event.type === 'message') {
    if (!event.final) return false
    if (trigger.pattern) {
      const actual = trigger.pattern.caseSensitive ? event.text : event.text.toLowerCase()
      const expected = trigger.pattern.caseSensitive
        ? trigger.pattern.value
        : trigger.pattern.value.toLowerCase()
      if (trigger.pattern.kind === 'exact' ? actual !== expected : !actual.includes(expected))
        return false
    }
  }
  return true
}
function remember(map: Map<string, number>, key: string, value: number) {
  map.delete(key)
  map.set(key, value)
  if (map.size > 4096) {
    const first = map.keys().next().value
    if (first !== undefined) map.delete(first)
  }
}
/** No endpoints, browser observers, timers, storage or DOM APIs are started here. */
export function createAutomationEngine(options: AutomationEngineOptions): AutomationEngine {
  let configuration = normalizeAutomationConfiguration(options.configuration),
    generation = 0,
    disposed = false,
    pending = 0
  let queue = Promise.resolve()
  const now = options.now ?? Date.now
  const events = new Set<AutomationEventListener>(),
    configurations = new Set<(configuration: AutomationConfiguration) => void>(),
    commands = new Set<(command: AutomationCommand, result: AutomationCommandResult) => void>()
  const seenEvents = new Map<string, number>(),
    seenCommands = new Map<string, number>(),
    cooldowns = new Map<string, number>()
  const configure = (input: unknown) => {
    if (disposed) throw Error('Automation engine is disposed')
    configuration = normalizeAutomationConfiguration(input)
    generation++
    notify(configurations, configuration)
  }
  const report = (command: AutomationCommand, result: AutomationCommandResult) => {
    for (const listener of [...commands])
      try {
        listener(copy(command), copy(result))
      } catch {
        /* Presentation owns its errors. */
      }
    return result
  }
  const dispatch = async (input: AutomationCommand): Promise<AutomationCommandResult> => {
    const command = commandOf(input),
      key = JSON.stringify([command.providerId, command.runId, command.commandId]),
      epoch = generation
    if (disposed || (command.origin === 'automation' && !configuration.enabled))
      return report(command, { status: 'ignored', reason: 'disabled' })
    if (seenCommands.has(key)) return report(command, { status: 'ignored', reason: 'duplicate' })
    if (pending >= 256) return report(command, { status: 'ignored', reason: 'queue-limit' })
    const remoteKind = command.action.type as RemoteCommandKind
    if (
      (command.origin === 'remote' &&
        (!configuration.remote.enabled ||
          configuration.remote.mode === 'local-only' ||
          !configuration.remote.allowedCommands.includes(remoteKind))) ||
      (command.action.type === 'remote-event' &&
        (!configuration.remote.enabled || configuration.remote.mode === 'local-only'))
    )
      return report(command, { status: 'ignored', reason: 'remote-disabled' })
    remember(seenCommands, key, now())
    pending++
    const task = queue
      .then(async (): Promise<AutomationCommandResult> => {
        if (disposed || (command.origin === 'automation' && !configuration.enabled))
          return report(command, { status: 'ignored', reason: 'disabled' })
        if (epoch !== generation)
          return report(command, { status: 'ignored', reason: 'configuration-changed' })
        try {
          // Trigger changes also go through the owner handler: an ACK must await
          // its persistent settings write, rather than just changing this copy.
          const result = await options.handleCommand(copy(command))
          return report(command, result ?? { status: 'executed' })
        } catch {
          return report(command, { status: 'failed', reason: 'handler-failed' })
        }
      })
      .finally(() => {
        pending--
      })
    queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }
  const publish = async (input: AutomationEvent): Promise<AutomationDispatchResult> => {
    const event = eventOf(input)
    if (event.type === 'dom' && !configuration.domEvents)
      return { accepted: false, matchedRules: 0, scheduledCommands: 0 }
    // A source message can keep its identity while moving from partial to
    // final; API request start/end also share a request identity.
    const phase =
      event.type === 'message'
        ? event.final
        : event.type === 'api'
          ? [event.name, event.status]
          : event.type === 'completion'
            ? event.outcome
            : 'name' in event
              ? event.name
              : null
    const key = JSON.stringify([event.providerId, event.runId, event.type, phase, event.eventId])
    if (disposed || seenEvents.has(key))
      return { accepted: false, matchedRules: 0, scheduledCommands: 0 }
    remember(seenEvents, key, now())
    notify(events, event)
    if (
      !configuration.enabled ||
      event.origin === 'automation' ||
      event.origin === 'remote' ||
      event.cause ||
      (event.type === 'dom' && !configuration.domEvents)
    )
      return { accepted: true, matchedRules: 0, scheduledCommands: 0 }
    let matchedRules = 0,
      scheduledCommands = 0
    for (const rule of configuration.rules) {
      const cooldownKey = JSON.stringify([event.providerId, rule.id]),
        at = now(),
        last = cooldowns.get(cooldownKey)
      if (
        !rule.enabled ||
        !matches(rule.trigger, event) ||
        (last !== undefined && at - last < rule.cooldownMs)
      )
        continue
      matchedRules++
      remember(cooldowns, cooldownKey, at)
      for (const [index, action] of rule.actions.entries()) {
        const command: AutomationCommand = {
          commandId: crypto.randomUUID(),
          providerId: event.providerId,
          runId: event.runId,
          ...(event.conversationId !== undefined ? { conversationId: event.conversationId } : {}),
          eventId: event.eventId,
          ruleId: rule.id,
          origin: 'automation',
          at,
          action,
        }
        // Scheduling does not await native actions. Providers may synchronously
        // publish caused facts without deadlocking the serial command queue.
        void dispatch(command)
        scheduledCommands++
        if (index >= 7) break
      }
    }
    return { accepted: true, matchedRules, scheduledCommands }
  }
  return {
    events: {
      async publish(event) {
        await publish(event)
      },
      subscribe(listener) {
        events.add(listener)
        return () => {
          events.delete(listener)
        }
      },
    },
    configuration: () => copy(configuration),
    configure,
    setEnabled: (enabled) => configure({ ...configuration, enabled }),
    upsertRule(input) {
      const rule = validateAutomationRule(input)
      const existing = configuration.rules.findIndex((value) => value.id === rule.id)
      const rules = [...configuration.rules]
      if (existing < 0) rules.push(rule)
      else rules[existing] = rule
      configure({ ...configuration, rules })
    },
    removeRule: (ruleId) =>
      configure({ ...configuration, rules: configuration.rules.filter((rule) => rule.id !== ruleId) }),
    subscribeConfiguration(listener) {
      configurations.add(listener)
      return () => {
        configurations.delete(listener)
      }
    },
    subscribeCommands(listener) {
      commands.add(listener)
      return () => {
        commands.delete(listener)
      }
    },
    publish,
    dispatch,
    dispose() {
      disposed = true
      generation++
      events.clear()
      configurations.clear()
      commands.clear()
      seenEvents.clear()
      seenCommands.clear()
      cooldowns.clear()
    },
  }
}
