import { expect, test } from 'bun:test'
import { validateVersionPolicy } from './version-policy'

test('published product versions cannot be manually maintained in source manifests', async () => {
  await expect(validateVersionPolicy()).resolves.toBeUndefined()
})
