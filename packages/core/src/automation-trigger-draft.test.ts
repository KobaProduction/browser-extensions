import { expect, test } from 'bun:test'
import { type AutomationRule, validateRemoteCommandPayload } from './automation'
import { createAutomationTriggerDraft } from './automation-trigger-draft'

const rule = (id: string): AutomationRule => ({
  id,
  label: id,
  enabled: true,
  trigger: { type: 'completion', outcome: 'complete' },
  actions: [{ type: 'stop' }],
  cooldownMs: 1000,
})
test('draft is live RAM state, preserves unrelated saved refresh and discards to latest saved', () => {
  const draft = createAutomationTriggerDraft([rule('saved')])
  draft.upsert(rule('draft'))
  expect(draft.state().unsaved).toBe(true)
  draft.acceptSaved([rule('saved')])
  expect(draft.state().draftRules.map((rule) => rule.id)).toEqual(['saved', 'draft'])
  draft.acceptSaved([rule('external')])
  expect(draft.state().draftRules.map((rule) => rule.id)).toEqual(['saved', 'draft'])
  draft.discard()
  expect(draft.state()).toMatchObject({
    savedRules: [rule('external')],
    draftRules: [rule('external')],
    unsaved: false,
  })
})
test('saving an earlier draft does not lose a concurrent RAM edit; restart restores only saved rules', () => {
  const draft = createAutomationTriggerDraft()
  draft.set([rule('first')])
  const saved = draft.state().draftRules
  draft.upsert(rule('second'))
  draft.acceptSaved(saved)
  expect(draft.state().unsaved).toBe(true)
  expect(
    createAutomationTriggerDraft(saved)
      .state()
      .draftRules.map((rule) => rule.id),
  ).toEqual(['first'])
  draft.acceptSaved(saved, true)
  expect(draft.state().unsaved).toBe(false)
})
test('typed draft API rejects executable patterns, unknown fields and malformed remove payloads', () => {
  expect(validateRemoteCommandPayload('triggers-draft-upsert', { rule: rule('safe') })).toEqual({
    rule: rule('safe'),
  })
  expect(() =>
    validateRemoteCommandPayload('triggers-draft-upsert', {
      rule: { ...rule('bad'), trigger: { type: 'message', pattern: { kind: 'regex', value: '.*' } } },
    }),
  ).toThrow()
  expect(() =>
    validateRemoteCommandPayload('triggers-draft-remove', { id: 'safe', execute: 'code' }),
  ).toThrow()
  expect(validateRemoteCommandPayload('triggers-draft-save', {})).toEqual({})
})

test('automation identities reject all ASCII control characters while preserving Unicode IDs', () => {
  for (let code = 0; code < 32; code++) {
    expect(() =>
      validateRemoteCommandPayload('triggers-get', {
        id: `synthetic${String.fromCharCode(code)}identity`,
      }),
    ).toThrow('Invalid automation identity')
  }
  expect(validateRemoteCommandPayload('triggers-get', { id: 'правило-😀' })).toEqual({
    id: 'правило-😀',
  })
})
