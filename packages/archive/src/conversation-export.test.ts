import { expect, test } from 'bun:test'
import {
  collectArchiveRange,
  safeArchiveExportLink,
  serializeArchiveExport,
  serializeArchiveExportChunks,
} from './conversation-export'
import { decodeArchiveClone, encodeArchiveClone } from './structured'

test('JSON formatter preserves provider codec values rather than converting binary metadata', async () => {
  const source = {
    map: new Map([['key', 42]]),
    binary: new Uint8Array([1, 4, 9]),
    blob: new Blob(['synthetic']),
  }
  const encoded = await encodeArchiveClone(source)
  const exported = serializeArchiveExport('json', {
    title: 'Synthetic',
    document: { provider: 'any', original: encoded },
    records: [],
  })
  const parsed = JSON.parse(exported.text)
  const decoded = decodeArchiveClone(parsed.original) as typeof source
  expect(decoded.map.get('key')).toBe(42)
  expect(decoded.binary).toEqual(source.binary)
  expect(await decoded.blob.text()).toBe('synthetic')
})
test('attachment links share safe Markdown/TXT formatting and never become executable destinations', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///private',
    '//evil.invalid/a',
    '../parent',
    'attachments/%2e%2e/private',
    'attachments/a%2fb',
    'https://user:password@example.invalid/file',
  ])
    expect(safeArchiveExportLink(url)).toBeNull()
  const input = {
    title: 'Synthetic',
    document: null,
    records: [
      {
        heading: 'Message',
        text: 'Text',
        attachments: [
          { name: 'file [name]<img>.png', url: 'attachments/1/file [name].png', status: 'included' },
          { name: 'Original', url: 'https://example.invalid/a_(b).png?x=1&y=2', status: 'not_included' },
          { name: 'Unsafe', url: 'javascript:alert(1)', status: 'unavailable' },
        ],
      },
    ],
  }
  const markdown = serializeArchiveExport('markdown', input).text
  expect(markdown).toContain(
    '[file \\[name\\]\\<img\\>.png](<attachments/1/file%20%5Bname%5D.png>) [included]',
  )
  expect(markdown).toContain('https://example.invalid/a_%28b%29.png?x=1&y=2')
  expect(markdown).not.toContain('javascript:')
  expect(markdown).not.toContain('<img>')
  const text = serializeArchiveExport('text', input).text
  expect(text).toContain('Original: https://example.invalid/a_%28b%29.png?x=1&y=2 [not_included]')
  expect(text).not.toContain('javascript:')
})
test('both providers share readable formats while source profiles remain explicit', () => {
  for (const provider of ['VK', 'ChatGPT']) {
    const input = {
      title: `${provider}\nSynthetic`,
      document: { provider },
      records: [
        { heading: 'User', text: 'first' },
        {
          heading: 'Assistant',
          text: 'answer',
          attachments: [{ name: 'file.txt', mime: 'text/plain' }],
          original: { text: '``` content' },
        },
      ],
    }
    const readable = serializeArchiveExport('markdown', input)
    expect(readable.text).toContain(`# ${provider} Synthetic`)
    expect(readable.text).toContain('## Assistant\n\nanswer')
    expect(readable.text).toContain('file.txt (text/plain)')
    expect(readable.text).not.toContain('Original record:')
    expect(serializeArchiveExport('markdown', { ...input, includeOriginal: true }).text).toContain(
      '````json',
    )
    expect(serializeArchiveExport('text', input)).toMatchObject({ mime: 'text/plain', extension: 'txt' })
    expect(serializeArchiveExport('markdown', { ...input, includeTitle: false }).text).not.toContain(
      `# ${provider}`,
    )
  }
})
test('range resolves actual saved identities across bounded pages and normalizes reversed endpoints', async () => {
  async function* paged() {
    for (let page = 0; page < 4; page++)
      for (let row = 0; row < 3; row++)
        yield { id: `message-${page * 3 + row}`, text: `row${page * 3 + row}` }
  }
  const selected = await collectArchiveRange(
    paged(),
    { firstId: 'message-8', lastId: 'message-2' },
    (row) => row.id,
  )
  expect(selected.messageIds).toEqual([
    'message-2',
    'message-3',
    'message-4',
    'message-5',
    'message-6',
    'message-7',
    'message-8',
  ])
  expect(selected.first.text).toBe('row2')
  expect(selected.last.text).toBe('row8')
  expect(
    (await collectArchiveRange(paged(), { firstId: 'message-4', lastId: 'message-4' }, (row) => row.id))
      .messageIds,
  ).toEqual(['message-4'])
  await expect(
    collectArchiveRange(paged(), { firstId: 'message-2', lastId: 'missing' }, (row) => row.id),
  ).rejects.toThrow('no longer saved')
})

test('chunked formats consume readable records lazily and preserve JSON and UTF-8 boundaries', () => {
  let consumed = 0
  function* records() {
    for (let index = 0; index < 300; index++) {
      consumed++
      yield { heading: `Message ${index}`, text: '🙂 synthetic '.repeat(200) }
    }
  }
  const output = serializeArchiveExportChunks('markdown', {
    document: null,
    title: 'Synthetic',
    records: records(),
  })
  expect(consumed).toBe(0)
  const iterator = output.chunks[Symbol.iterator]()
  const first = iterator.next()
  expect(first.done).toBe(false)
  expect(consumed).toBeLessThan(300)
  if (first.done) throw Error('Expected lazy formatter output')
  const chunks = [first.value, ...{ [Symbol.iterator]: () => iterator }]
  const fromBytes = new TextDecoder().decode(new TextEncoder().encode(chunks.join('')))
  expect(fromBytes).not.toContain('�')
  expect(fromBytes).toContain('Message 299')
  const document = {
    optional: undefined,
    rows: [{ text: '🙂'.repeat(40000) }, { text: 'last' }],
    selection: [undefined, null],
  }
  const json = serializeArchiveExportChunks('json', { document, title: '', records: [] })
  expect([...json.chunks].join('')).toBe(JSON.stringify(document, null, 2))
})

test('full readable originals support many code markers without an argument-limit failure', () => {
  const original = { text: ['` marker '.repeat(150000), '````'].join('') }
  const output = serializeArchiveExport('markdown', {
    document: null,
    title: '',
    records: [{ heading: 'Source', text: '', original }],
    includeOriginal: true,
  })
  expect(output.text).toContain('`````json')
})
