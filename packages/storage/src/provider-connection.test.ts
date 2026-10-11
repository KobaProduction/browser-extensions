import { expect, test } from 'bun:test'
import { connectScopedArchive, type ScopedArchiveReadProvider } from './provider-connection'
import type { ServiceScope } from './service-contract'

const aggregate: ServiceScope = { productId: 'all-in-one', channel: 'dev', ownerId: 'verified-A' }
function provider() {
  let approved = false
  let reads = 0
  const source: ScopedArchiveReadProvider = {
    scope: { productId: 'chatgpt-booster', channel: 'dev', ownerId: 'verified-A' },
    async authorizeRead() {
      return approved
    },
    async readSnapshot() {
      reads++
      return new Blob(['synthetic'])
    },
  }
  return {
    source,
    allow() {
      approved = true
    },
    deny() {
      approved = false
    },
    get reads() {
      return reads
    },
  }
}

test('read-only aggregate connection requires live provider consent and can be revoked', async () => {
  const p = provider()
  const connection = connectScopedArchive(aggregate, p.source)
  await expect(connection.read()).rejects.toThrow('consent')
  p.allow()
  expect(await (await connection.read()).text()).toBe('synthetic')
  p.deny()
  await expect(connection.read()).rejects.toThrow('consent')
  connection.revoke()
  await expect(connection.read()).rejects.toThrow('revoked')
  expect(p.reads).toBe(1)
})

test('rejects wrong provider, owner, channel and unsupported non-aggregate callers', async () => {
  const p = provider()
  expect(() => connectScopedArchive(aggregate, null)).toThrow('unavailable')
  expect(() => connectScopedArchive({ ...aggregate, channel: 'prod' }, p.source)).toThrow('mismatch')
  expect(() => connectScopedArchive({ ...aggregate, ownerId: 'other' }, p.source)).toThrow('mismatch')
  expect(() => connectScopedArchive({ ...aggregate, ownerId: undefined }, p.source)).toThrow('mismatch')
  expect(() =>
    connectScopedArchive({ productId: 'vk-booster', channel: 'dev', ownerId: 'verified-A' }, p.source),
  ).toThrow('aggregate')
})

test('revocation during an in-flight provider read prevents snapshot delivery', async () => {
  let finish: ((snapshot: Blob) => void) | undefined
  const deferred = new Promise<Blob>((resolve) => {
    finish = resolve
  })
  const source: ScopedArchiveReadProvider = {
    scope: { productId: 'chatgpt-booster', channel: 'dev', ownerId: 'verified-A' },
    async authorizeRead() {
      return true
    },
    async readSnapshot() {
      return deferred
    },
  }
  const connection = connectScopedArchive(aggregate, source)
  const result = connection.read()
  // Allow consent verification and source read to start before revocation.
  await Promise.resolve()
  await Promise.resolve()
  connection.revoke()
  finish?.(new Blob(['private synthetic payload']))
  await expect(result).rejects.toThrow('revoked')
})
