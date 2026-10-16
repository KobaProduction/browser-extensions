import { expect, test } from 'bun:test'
import {
  compareSourceObservation,
  sourceCloneFingerprint,
  sourceFingerprint,
} from './archive-observation-policy'

test('clone fingerprints compare exact native values and distinguish portable structural signatures', async () => {
  const values = [
    [new Map([['key', 1]]), new Map([['key', 2]])],
    [new Set([1]), new Set([2])],
    [new Date(1), new Date(2)],
    [new Blob(['first']), new Blob(['other'])],
    [new Uint8Array([1]).buffer, new Uint8Array([2]).buffer],
    [new Uint8Array([1]), new Int8Array([1])],
    [1n, 2n],
    [{ key: undefined }, {}],
    [[undefined], [null]],
    [Array(1), [undefined]],
    [-0, 0],
    [new Map(), {}],
  ]
  for (const [before, after] of values) {
    const fingerprint = await sourceCloneFingerprint(before)
    expect(await sourceCloneFingerprint(structuredClone(before))).toBe(fingerprint)
    expect(await sourceCloneFingerprint(after)).not.toBe(fingerprint)
  }
  expect(await sourceCloneFingerprint({ b: 1, a: { d: 2, c: 3 } })).toBe(
    await sourceCloneFingerprint({ a: { c: 3, d: 2 }, b: 1 }),
  )
  expect(sourceFingerprint({ key: undefined })).not.toBe(sourceFingerprint({}))
  expect(sourceFingerprint([undefined])).not.toBe(sourceFingerprint([null]))
})

test('synchronous presentation comparison preserves unknown native values conservatively', () => {
  const before = { id: 'message', future: new Blob(['same']) }
  expect(compareSourceObservation(before, structuredClone(before))).toBe('conflict')
})
