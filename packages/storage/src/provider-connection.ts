import { assertServiceScope, type ServiceScope } from './service-contract'

/** The provider, never the aggregator, owns authorization and physical data.
 * The provider's authorizeRead must verify real user consent and account
 * ownership on EVERY call, not merely check a caller-supplied boolean. */
export interface ScopedArchiveReadProvider {
  readonly scope: ServiceScope
  authorizeRead(consumer: ServiceScope): Promise<boolean>
  readSnapshot(): Promise<Blob>
}
export interface RevocableArchiveConnection {
  read(): Promise<Blob>
  revoke(): void
}

/** No IndexedDB/storage name inspection, no write privileges, no cross-channel access. */
export function connectScopedArchive(
  consumer: ServiceScope,
  provider: ScopedArchiveReadProvider | null,
): RevocableArchiveConnection {
  assertServiceScope(consumer)
  if (consumer.productId !== 'all-in-one')
    throw new Error('Only aggregate may request provider snapshots')
  if (!provider) throw new Error('Archive provider is unavailable')
  assertServiceScope(provider.scope)
  if (
    provider.scope.productId === 'all-in-one' ||
    consumer.channel !== provider.scope.channel ||
    !consumer.ownerId ||
    !provider.scope.ownerId ||
    consumer.ownerId !== provider.scope.ownerId
  ) {
    throw new Error('Archive connection channel or verified owner mismatch')
  }
  let revoked = false
  return {
    async read() {
      if (revoked) throw new Error('Archive connection revoked')
      // Authorization happens at read time so a prior consent cannot survive
      // a provider revocation, account switch, or disabled installation.
      if (!(await provider.authorizeRead(consumer)) || revoked)
        throw new Error('Archive connection lacks current user consent')
      if (consumer.ownerId !== provider.scope.ownerId || consumer.channel !== provider.scope.channel)
        throw new Error('Archive provider ownership changed')
      return provider.readSnapshot()
    },
    revoke() {
      revoked = true
    },
  }
}
