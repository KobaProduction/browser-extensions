import { expect, test } from 'bun:test'
import { createStoredZip, createStoredZipFromBlobs } from './stored-zip'

test('shared ChatGPT/VK ZIP writer preserves entry headers and rejects unsafe paths', async () => {
  const entries = [
    { path: 'messages/000001.json', blob: new Blob(['[{"id":1}]']) },
    { path: 'attachments/status.json', blob: new Blob(['[]']) },
    { path: 'manifest.json', blob: new Blob(['{"complete":false}']) },
  ]
  const events: number[] = []
  const zip = await createStoredZipFromBlobs(entries, undefined, (done) => events.push(done))
  expect(zip.type).toBe('application/zip')
  const data = new Uint8Array(await zip.arrayBuffer())
  const view = new DataView(data.buffer)
  expect(view.getUint32(0, true)).toBe(0x04034b50)
  expect(view.getUint32(data.length - 22, true)).toBe(0x06054b50)
  expect(view.getUint16(data.length - 22 + 8, true)).toBe(3)
  expect(events.at(-1)).toBe(entries.reduce((sum, row) => sum + row.blob.size, 0))
  expect(() => createStoredZip([{ path: '../private.json', bytes: new Uint8Array([1]) }])).toThrow(
    'Unsafe',
  )
  await expect(createStoredZipFromBlobs([{ path: '/absolute', blob: new Blob(['x']) }])).rejects.toThrow(
    'Unsafe',
  )
})
