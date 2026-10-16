import { expect, test } from 'bun:test'
import {
  type AutomationCommand,
  type AutomationEvent,
  createAutomationEngine,
  DEFAULT_AUTOMATION_CONFIGURATION,
  validateAutomationRule,
  validateRemoteCommandPayload,
} from './automation'

const rule = {
  id: 'source-sound',
  label: 'Synthetic source notification',
  enabled: true,
  trigger: { type: 'completion', outcome: 'complete' },
  cooldownMs: 0,
  actions: [
    { type: 'play-sound', tone: 'soft' },
    { type: 'play-sound', tone: 'chime' },
    { type: 'play-sound', tone: 'pulse' },
  ],
}
test('source completion dispatches validated sound actions once and preserves event causality', async () => {
  const executed: AutomationCommand[] = []
  let finished: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    finished = resolve
  })
  const engine = createAutomationEngine({
    configuration: {
      ...DEFAULT_AUTOMATION_CONFIGURATION,
      enabled: true,
      rules: [validateAutomationRule(rule)],
    },
    handleCommand(command) {
      executed.push(command)
    },
  })
  engine.subscribeCommands(() => {
    if (executed.length === 3) finished()
  })
  const event: AutomationEvent = {
    type: 'completion',
    outcome: 'complete',
    eventId: 'synthetic-complete',
    runId: 'synthetic-run',
    providerId: 'synthetic-provider',
    conversationId: 'synthetic-conversation',
    origin: 'provider',
    at: 1,
  }
  expect(await engine.publish(event)).toMatchObject({ matchedRules: 1, scheduledCommands: 3 })
  await done
  expect(executed.map((command) => command.action)).toEqual(rule.actions)
  expect(executed.every((command) => command.eventId === event.eventId)).toBe(true)
  expect(await engine.publish(event)).toMatchObject({ accepted: false, scheduledCommands: 0 })
  engine.dispose()
})

test('sound rules reject executable/custom audio fields and direct remote playback is unsupported', () => {
  for (const action of [
    { type: 'play-sound' },
    { type: 'play-sound', tone: 'unknown' },
    { type: 'play-sound', tone: 'chime', url: 'https://audio.example.test/file.mp3' },
  ])
    expect(() => validateAutomationRule({ ...rule, actions: [action] })).toThrow()
  expect(validateRemoteCommandPayload('triggers-draft-set', { rules: [rule] })).toEqual({
    rules: [rule],
  })
  expect(() => validateRemoteCommandPayload('play-sound' as never, { tone: 'chime' })).toThrow()
})
