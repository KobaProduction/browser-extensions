import { expect, test } from 'bun:test'
import {
  BACKUP_WIRE_CHUNK,
  BackupFragmentDecoder,
  backupWireLines,
  MAX_BACKUP_ROW_BYTES,
} from './backup-fragments'

test('v2 fragments preserve escaping, UTF-16 and UTF-8 under the four MiB wire bound', async () => {
  const original = { key: 'synthetic', value: '\n🙂я'.repeat(1024 * 1024) }
  const decoder = new BackupFragmentDecoder()
  let restored: unknown,
    logicalRows = 0,
    count = 0
  for await (const { line, rows } of backupWireLines(original)) {
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(BACKUP_WIRE_CHUNK)
    logicalRows += rows
    restored = (await decoder.consume(JSON.parse(line), 'synthetic.archive')) ?? restored
    count++
  }
  decoder.assertComplete()
  expect(decoder.usedFragments).toBe(true)
  expect(count).toBeGreaterThan(2)
  expect(logicalRows).toBe(1)
  expect(restored).toEqual(original)
})

test('missing, reordered, duplicated, changed and foreign-section fragments reject', async () => {
  const units: unknown[] = []
  for await (const unit of backupWireLines({ key: 'synthetic', value: 'x'.repeat(5 * 1024 * 1024) }))
    units.push(JSON.parse(unit.line))
  const first = units[0],
    second = units[1]
  const missing = new BackupFragmentDecoder()
  await missing.consume(first, 'synthetic.archive')
  expect(() => missing.assertComplete()).toThrow('Missing')
  await expect(missing.consume(units[2], 'synthetic.archive')).rejects.toThrow('unordered')
  const duplicate = new BackupFragmentDecoder()
  await duplicate.consume(first, 'synthetic.archive')
  await duplicate.consume(second, 'synthetic.archive')
  await expect(duplicate.consume(second, 'synthetic.archive')).rejects.toThrow('duplicate')
  const foreign = new BackupFragmentDecoder()
  await foreign.consume(first, 'synthetic.archive')
  await expect(foreign.consume(second, 'other.archive')).rejects.toThrow('unordered')
  const tampered = new BackupFragmentDecoder()
  await expect(
    (async () => {
      for (const [index, unit] of units.entries()) {
        const value = structuredClone(unit) as Record<string, unknown>
        if (index === 2 && typeof value.payload === 'string')
          value.payload = `y${value.payload.slice(1)}`
        await tampered.consume(value, 'synthetic.archive')
      }
    })(),
  ).rejects.toThrow('integrity')
  const excessive = new BackupFragmentDecoder()
  await expect(
    excessive.consume({ ...(first as object), bytes: MAX_BACKUP_ROW_BYTES + 1 }, 'synthetic.archive'),
  ).rejects.toThrow('budget')
})

test('multibyte fragments cannot exceed declared UTF-8 allocation before the final fragment arrives', async () => {
  const decoder = new BackupFragmentDecoder()
  await decoder.consume(
    {
      type: 'row-fragments-v1',
      key: 'synthetic',
      fragments: 92,
      characters: 23 * 1024 * 1024,
      bytes: MAX_BACKUP_ROW_BYTES,
      sha256: '0'.repeat(64),
    },
    'synthetic.archive',
  )
  const payload = '汉'.repeat(256 * 1024)
  for (let index = 0; index < 85; index++)
    await decoder.consume({ type: 'row-fragment-v1', index, payload }, 'synthetic.archive')
  await expect(
    decoder.consume({ type: 'row-fragment-v1', index: 85, payload }, 'synthetic.archive'),
  ).rejects.toThrow('UTF-8 reassembly budget')
})
