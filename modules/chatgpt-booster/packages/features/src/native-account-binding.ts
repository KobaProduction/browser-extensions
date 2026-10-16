import type { ChatGptNativeAccountSource } from '@chatgpt-booster/observer'
import type { ChatGptNativeApplicationScope } from './native-binding'

export const CHATGPT_NATIVE_ACCOUNT_CONTRACT = 'chatgpt-native-accounts-2026-10-15-v1'
export interface ChatGptNativeAccountBindingOptions {
  contractVersion: typeof CHATGPT_NATIVE_ACCOUNT_CONTRACT
  scope: ChatGptNativeApplicationScope
  /** Source-inspected cached Iet.c: genuine native account refresh, including appServices inputs. */
  modules: {
    Iet: {
      c(scope: ChatGptNativeApplicationScope, signal: AbortSignal, force: boolean): Promise<unknown>
    }
    g2: { n: unknown }
    Cs: { i: unknown }
  }
}
export function createChatGptNativeAccountSource(
  options: ChatGptNativeAccountBindingOptions,
): ChatGptNativeAccountSource {
  if (
    options.contractVersion !== CHATGPT_NATIVE_ACCOUNT_CONTRACT ||
    typeof options.scope?.get !== 'function' ||
    typeof options.modules?.Iet?.c !== 'function'
  )
    throw Error('automation.nativeMethodUnavailable')
  const { scope, modules } = options
  return {
    async read(signal) {
      const accountId = scope.get(modules.g2.n),
        userId = scope.get(modules.Cs.i)
      const assertIdentity = () => {
        if (signal.aborted) throw Error('automation.commandCancelled')
        if (
          typeof accountId !== 'string' ||
          !accountId ||
          typeof userId !== 'string' ||
          !userId ||
          scope.get(modules.g2.n) !== accountId ||
          scope.get(modules.Cs.i) !== userId
        )
          throw Error('automation.ownerChanged')
      }
      assertIdentity()
      const result = await Reflect.apply(modules.Iet.c, undefined, [scope, signal, true])
      assertIdentity()
      const registry = result as {
        default_account_id?: unknown
        accounts?: unknown
        account_ordering?: unknown
      } | null
      if (
        !registry ||
        registry.default_account_id !== accountId ||
        !Array.isArray(registry.accounts) ||
        !Array.isArray(registry.account_ordering)
      )
        throw Error('automation.nativeMethodUnavailable')
      const accountIds: string[] = []
      for (const raw of registry.accounts) {
        const account = raw as {
          id?: unknown
          account_id?: unknown
          can_access_with_session?: unknown
        } | null
        if (
          !account ||
          typeof account.id !== 'string' ||
          !account.id ||
          (account.account_id !== undefined && account.account_id !== account.id)
        )
          throw Error('automation.nativeMethodUnavailable')
        if (account.can_access_with_session !== false) accountIds.push(account.id)
      }
      if (!accountIds.includes(accountId as string) || !registry.account_ordering.includes(accountId))
        throw Error('automation.nativeMethodUnavailable')
      return { selectedAccountId: accountId as string, accountIds: [...new Set(accountIds)] }
    },
  }
}
