import { type AutomationRule, validateAutomationRule, validateAutomationRules } from './automation'

export interface AutomationTriggerDraftState {
  readonly savedRules: readonly AutomationRule[]
  readonly draftRules: readonly AutomationRule[]
  readonly unsaved: boolean
  readonly revision: number
}
export interface AutomationTriggerDraft {
  state(): AutomationTriggerDraftState
  /** Refresh saved baseline; a dirty draft survives unrelated or external writes. */
  acceptSaved(rules: readonly AutomationRule[], replaceDraft?: boolean): void
  set(rules: readonly AutomationRule[]): void
  upsert(rule: AutomationRule): void
  remove(id: string): void
  reset(): void
  discard(): void
}
/** Ephemeral runtime state. Saving belongs to the injected provider settings port. */
export function createAutomationTriggerDraft(
  initial: readonly AutomationRule[] = [],
): AutomationTriggerDraft {
  let saved = validateAutomationRules(initial),
    draft = structuredClone(saved),
    revision = 0
  const same = (a: readonly AutomationRule[], b: readonly AutomationRule[]) =>
    JSON.stringify(a) === JSON.stringify(b)
  const set = (rules: readonly AutomationRule[]) => {
    const next = validateAutomationRules(rules)
    if (!same(next, draft)) {
      draft = next
      revision++
    }
  }
  return {
    state: () => ({
      savedRules: structuredClone(saved),
      draftRules: structuredClone(draft),
      unsaved: !same(saved, draft),
      revision,
    }),
    acceptSaved(rules, replaceDraft = false) {
      const next = validateAutomationRules(rules),
        dirty = !same(saved, draft)
      const changed = !same(saved, next)
      saved = next
      if (replaceDraft || !dirty) set(next)
      if (changed) revision++
    },
    set,
    upsert(input) {
      const rule = validateAutomationRule(input),
        next = [...draft],
        index = next.findIndex((value) => value.id === rule.id)
      if (index < 0) next.push(rule)
      else next[index] = rule
      set(next)
    },
    remove(id) {
      set(draft.filter((rule) => rule.id !== id))
    },
    reset() {
      set([])
    },
    discard() {
      set(saved)
    },
  }
}
