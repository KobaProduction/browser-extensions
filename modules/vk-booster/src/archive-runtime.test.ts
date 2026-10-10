import { afterAll, beforeAll, expect, test } from 'bun:test'
import { installVkArchive } from './archive-runtime'
import type {
  ArchiveApi,
  ArchiveRunResult,
  VkArchiveMeta,
  VkMessage,
} from './features/chat-export/model/types'

class MockFile {
  bytes: Uint8Array = new Uint8Array(0)
  readonly kind = 'file'
  async getFile() {
    const bytes = this.bytes
    return {
      size: bytes.length,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.slice().buffer,
    }
  }
  async createWritable() {
    const file = this
    let pending: Uint8Array | null = null
    return {
      async write(data: string | Blob | Uint8Array) {
        pending =
          typeof data === 'string'
            ? new TextEncoder().encode(data)
            : data instanceof Uint8Array
              ? data
              : new Uint8Array(await data.arrayBuffer())
      },
      async close() {
        if (pending) file.bytes = pending
      },
      async abort() {
        pending = null
      },
    }
  }
}
class MockDir {
  readonly kind = 'directory'
  readonly files = new Map<string, MockFile>()
  readonly dirs = new Map<string, MockDir>()
  constructor(readonly name: string) {}
  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<MockFile> {
    let file = this.files.get(name)
    if (!file) {
      if (!options.create) {
        const error = new Error('Missing')
        error.name = 'NotFoundError'
        throw error
      }
      file = new MockFile()
      this.files.set(name, file)
    }
    return file
  }
  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<MockDir> {
    let dir = this.dirs.get(name)
    if (!dir) {
      if (!options.create) {
        const error = new Error('Missing')
        error.name = 'NotFoundError'
        throw error
      }
      dir = new MockDir(name)
      this.dirs.set(name, dir)
    }
    return dir
  }
}
const folderHandle = (d: MockDir): FileSystemDirectoryHandle => d as unknown as FileSystemDirectoryHandle

const save = {
  document: globalThis.document,
  location: globalThis.location,
  localStorage: globalThis.localStorage,
  sessionStorage: globalThis.sessionStorage,
  fetch: globalThis.fetch,
  flag: globalThis.__VK_EXPORT_TEST_MODE,
  showDirectoryPicker: globalThis.showDirectoryPicker,
}
globalThis.__VK_EXPORT_TEST_MODE = true
Object.assign(globalThis, { document: {}, location: { pathname: '/im/convo/7654321' } })
const peer = 7654321,
  tok = 'test-origin-token-123456789'
const all: VkMessage[] = Array.from({ length: 3100 }, (_, i) => ({
  id: 3100 - i,
  date: 1791500000 - i * 500,
  from_id: i % 2 ? peer : 123,
  peer_id: peer,
  out: i % 2,
  text:
    i === 5
      ? '</script><img src=x onerror=alert(1)> https://example.com/paper'
      : 'Message ' + (3100 - i),
  attachments: [],
}))
const originalName = 'Исходный_документ.pdf'
const bytes = new TextEncoder().encode('%PDF-1.7\nReal binary content\n%%EOF')
const docMessage = all[3]
if (!docMessage) throw Error('Missing docMessage')
docMessage.attachments = [
  {
    type: 'doc',
    doc: {
      id: 45,
      owner_id: 12,
      url: 'https://cdn.mock/original.pdf',
      title: originalName,
      ext: 'pdf',
      size: bytes.length,
    },
  },
]
const voiceMessage = all[9]
if (!voiceMessage) throw Error('Missing voiceMessage')
voiceMessage.attachments = [
  {
    type: 'audio_message',
    audio_message: {
      link_ogg: 'https://cdn.mock/voice.ogg',
      duration: 3,
      transcript: 'Проверочное аудио',
    },
  },
]
const linkMessage = all[11]
if (!linkMessage) throw Error('Missing linkMessage')
linkMessage.attachments = [
  { type: 'link', link: { url: 'https://example.org/docs', title: 'Документы' } },
]
const ogg = new TextEncoder().encode('OggS-synthetic-audio')
const stores = { length: 1, key: () => 'vk_auth', getItem: () => JSON.stringify({ access_token: tok }) }
Object.assign(globalThis, {
  localStorage: stores,
  sessionStorage: { length: 0, key: () => null, getItem: () => null },
})
let apiCalls = 0,
  mediaCalls = 0,
  pauseAfter = 0,
  switchPeerDuringHistory: number | null = null
Object.assign(globalThis, {
  fetch: async (url: RequestInfo | URL, o?: RequestInit) => {
    if (String(url).includes('/method/')) {
      const p = new URLSearchParams(o?.body as string | URLSearchParams)
      expect(p.get('access_token')).toBe(tok)
      apiCalls++
      if (pauseAfter && apiCalls === pauseAfter) {
        queueMicrotask(() => globalThis.VKExport?.stop())
      }
      if (
        switchPeerDuringHistory !== null &&
        String(url).includes('messages.getHistory') &&
        p.get('count') !== '1'
      ) {
        globalThis.location.pathname = '/im/convo/' + String(switchPeerDuringHistory)
        switchPeerDuringHistory = null
      }
      const offset = Number(p.get('offset')),
        count = Number(p.get('count'))
      return new Response(
        JSON.stringify({ response: { items: all.slice(offset, offset + count), count: all.length } }),
        { status: 200 },
      )
    }
    mediaCalls++
    return new Response(String(url).endsWith('.ogg') ? ogg : bytes, {
      status: 200,
      headers: { 'content-type': String(url).endsWith('.ogg') ? 'audio/ogg' : 'application/pdf' },
    })
  },
})
const reload = (): ArchiveApi => {
  delete globalThis.VKExport
  installVkArchive()
  if (!globalThis.VKExport) throw Error('No VK API')
  return globalThis.VKExport
}
let a: ArchiveApi, folder: MockDir
beforeAll(async () => {
  a = reload()
  folder = new MockDir('VK_Archive_v2')
  await a.useFolder(folderHandle(folder))
})
afterAll(() => {
  Object.assign(globalThis, {
    document: save.document,
    location: save.location,
    localStorage: save.localStorage,
    sessionStorage: save.sessionStorage,
    fetch: save.fetch,
    __VK_EXPORT_TEST_MODE: save.flag,
    showDirectoryPicker: save.showDirectoryPicker,
  })
  delete globalThis.VKExport
})
const read = async (name: string) =>
  JSON.parse(await (await folder.getFileHandle(name)).getFile().then((f) => f.text()))
type FinishedRun = Extract<ArchiveRunResult, { matched: number }>
async function completed(run: Promise<ArchiveRunResult>): Promise<FinishedRun> {
  const result = await run
  if ('paused' in result) throw Error('Unexpected paused archive')
  return result
}
test('exact N=3000 even if previously saved, and only two JSON outputs', async () => {
  const r = await completed(
    a.run({ mode: 'recent', limit: 3000, pageSize: 50, media: false, delay: 300 }),
  )
  expect(r.matched).toBe(3000)
  expect(r.newCount).toBe(3000)
  const m = await read('messages.json')
  expect(m.messages).toHaveLength(3000)
  const md = (await read('metadata.json')) as VkArchiveMeta
  expect(md.total).toBe(3000)
  expect(md.checkpoint?.status).toBe('done')
  expect([...folder.files.keys()].sort()).toEqual(['index.html', 'messages.json', 'metadata.json'])
  expect(a.status().progress.done).toBe(3000)
  const preview = a.previewMessages({ limit: 80 })
  expect(preview.messages).toHaveLength(80)
  expect(preview.matching).toBe(3000)
  expect(preview.messages.at(-1)?.id).toBe(m.messages.at(-1)?.id)
})
test('repeat last N does not terminate on first existing ID or create duplicates', async () => {
  const before = mediaCalls
  const r = await completed(
    a.run({ mode: 'recent', limit: 3000, pageSize: 100, media: false, delay: 300 }),
  )
  expect(r.matched).toBe(3000)
  expect(r.newCount).toBe(0)
  expect((await read('messages.json')).messages).toHaveLength(3000)
  expect(mediaCalls).toBe(before)
})
test('incremental stops at first known message and adds newest ID', async () => {
  all.unshift({
    id: 3101,
    date: 1791500100,
    peer_id: peer,
    from_id: 123,
    text: 'Newest',
    attachments: [],
  })
  const r = await completed(
    a.run({ mode: 'incremental', limit: 200, pageSize: 50, media: false, delay: 300 }),
  )
  expect(r.newCount).toBe(1)
  expect((await read('messages.json')).messages).toHaveLength(3001)
})
test('pause and resume backfill without losing checkpoint', async () => {
  pauseAfter = apiCalls + 2
  const r = await a.run({ mode: 'backfill', limit: 80, pageSize: 20, media: false, delay: 300 })
  if (!('paused' in r)) throw Error('Expected paused run')
  expect(r.paused).toBe(true)
  expect((await read('metadata.json')).checkpoint.status).toBe('paused')
  pauseAfter = 0
  const r2 = await completed(a.resume())
  expect(r2.matched).toBe(80)
  expect((await read('metadata.json')).checkpoint.status).toBe('done')
})
test('original names, offline HTML, media path and hashes', async () => {
  const r = await completed(a.run({ mode: 'recent', limit: 12, pageSize: 20, media: true, delay: 300 }))
  expect(r.matched).toBe(12)
  const md = (await read('metadata.json')) as VkArchiveMeta
  const saved = Object.values(md.files).filter((x) => x.status === 'saved')
  expect(saved.length).toBe(2)
  expect(saved.some((x) => x.name === originalName)).toBe(true)
  expect(saved.every((x) => typeof x.sha256 === 'string' && /^[0-9a-f]{64}$/.test(x.sha256))).toBe(true)
  const voiceKey = Object.keys(md.files).find((x) => x.includes('audio_message'))
  if (!voiceKey) throw Error('No voice attachment')
  expect(md.files[voiceKey]?.name).toBe('Голосовое.ogg')
  const html = await (await folder.getFileHandle('index.html')).getFile().then((f) => f.text())
  expect(html).toContain("target='_blank'")
  expect(html).toContain('Поиск по сообщениям')
  expect(html).toContain('media/')
  expect(html).toContain('https://example.org/docs')
  expect(html).toContain('Проверочное аудио')
  expect(html).not.toContain('</script><img src=x')
  const block = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  expect(block).toBeTruthy()
  if (!block) throw Error('Missing inline viewer script')
  expect(() => new Function(block)).not.toThrow()
  expect(block).toContain('target=')
})
test('reconnect folder after simulated reload reads only two files', async () => {
  const old = folder
  a = reload()
  await a.useFolder(folderHandle(old))
  expect(a.status().messages).toBeGreaterThanOrEqual(3000)
  expect(a.status().checkpoint?.status).toBe('done')
})
test('legacy v1 folder rejected without deleting its contents', async () => {
  const d = new MockDir('old')
  const f = await d.getFileHandle('metadata.json', { create: true }),
    w = await f.createWritable()
  await w.write(JSON.stringify({ schema: 1, peer_id: peer }))
  await w.close()
  await expect(a.useFolder(folderHandle(d))).rejects.toThrow()
})
test('date filters include the full through day in Moscow timezone', async () => {
  const backup = [...all]
  const time = (s: string) => Math.floor(Date.parse(s) / 1000)
  const items = [
    { id: 5, date: time('2026-10-09T21:00:00Z'), text: 'next day excluded' }, // Moscow 2026-10-10
    { id: 4, date: time('2026-10-09T20:59:00Z'), text: 'through 23:59' }, // Moscow 2026-10-09
    { id: 3, date: time('2026-10-07T21:00:00Z'), text: 'from midnight' }, // Moscow 2026-10-08
    { id: 2, date: time('2026-10-07T20:59:00Z'), text: 'before excluded' },
  ].map((m) => ({ ...m, peer_id: peer, from_id: 123, attachments: [] }))
  all.splice(0, all.length, ...items)
  try {
    a = reload()
    const f = new MockDir('date-filter')
    await a.useFolder(folderHandle(f))
    const r = await completed(
      a.run({
        mode: 'recent',
        limit: 10,
        from: '2026-10-08',
        through: '2026-10-09',
        pageSize: 4,
        delay: 300,
        media: false,
      }),
    )
    expect(r.matched).toBe(2)
    expect(r.saved).toBe(2)
    expect(
      (await (await f.getFileHandle('messages.json')).getFile().then((x) => x.text())).includes(
        '"id": 4',
      ),
    ).toBe(true)
  } finally {
    all.splice(0, all.length, ...backup)
  }
})

test('v1 folder with state.json and pages is rejected before v2 files are created', async () => {
  a = reload()
  const old = new MockDir('original-v1')
  await old.getFileHandle('state.json', { create: true })
  await old.getDirectoryHandle('pages', { create: true })
  await expect(a.useFolder(folderHandle(old))).rejects.toThrow('старый архив v1')
  expect([...old.files.keys()]).toEqual(['state.json'])
  expect([...old.dirs.keys()]).toEqual(['pages'])
})

test('rejecting malformed new folder preserves previously selected archive', async () => {
  a = reload()
  await a.useFolder(folderHandle(folder))
  const before = a.status()
  const invalid = new MockDir('bad-metadata')
  const writer = await (await invalid.getFileHandle('metadata.json', { create: true })).createWritable()
  await writer.write('{not-json')
  await writer.close()
  await expect(a.useFolder(folderHandle(invalid))).rejects.toThrow()
  expect(a.status().folder).toBe(before.folder)
  expect(a.status().messages).toBe(before.messages)
  expect([...invalid.files.keys()]).toEqual(['metadata.json'])
  const result = await completed(
    a.run({ mode: 'recent', limit: 2, pageSize: 2, media: false, delay: 300 }),
  )
  expect(result.saved).toBe(before.messages)
})

test('failed metadata commit does not advance visible cursor or silently keep unsaved rows', async () => {
  a = reload()
  const scratch = new MockDir('write-failure')
  await a.useFolder(folderHandle(scratch))
  const md = await scratch.getFileHandle('metadata.json')
  const originalWritable = md.createWritable.bind(md)
  let failOnce = true
  md.createWritable = async () => {
    const writer = await originalWritable()
    return {
      ...writer,
      async write(data: string | Blob | Uint8Array) {
        if (failOnce) {
          failOnce = false
          throw Error('synthetic metadata disk failure')
        }
        await writer.write(data)
      },
    }
  }
  await expect(
    a.run({ mode: 'recent', limit: 12, pageSize: 12, media: false, delay: 300 }),
  ).rejects.toThrow('synthetic metadata disk failure')
  expect(a.status().messages).toBe(0)
  expect(
    (await (await scratch.getFileHandle('messages.json')).getFile().then((f) => f.text())).includes(
      '"messages": []',
    ),
  ).toBe(true)
  const cp = await (await scratch.getFileHandle('metadata.json')).getFile().then((f) => f.text())
  expect(JSON.parse(cp).checkpoint.offset).toBe(0)
  const resumed = await completed(a.resume())
  expect(resumed.saved).toBe(12)
})

test('soft-navigation to another chat blocks export and never binds its folder to the previous chat', async () => {
  a = reload()
  await a.useFolder(folderHandle(folder))
  const before = a.status()
  const saved = await (await folder.getFileHandle('messages.json')).getFile().then((file) => file.text())
  const another = 7654322
  globalThis.location.pathname = '/im/convo/' + another
  try {
    const mismatch = a.status()
    expect(mismatch.options.peerId).toBe(peer)
    expect(mismatch.activePeerId).toBe(another)
    expect(mismatch.blockedReason).toContain('другая переписка')
    await expect(
      a.run({ mode: 'recent', limit: 2, pageSize: 2, media: false, delay: 300 }),
    ).rejects.toThrow('Выбран другой диалог VK')
    await expect(a.resume()).rejects.toThrow('другая переписка')
    await expect(a.useFolder(folderHandle(folder))).rejects.toThrow()
    expect(a.status().folder).toBe(before.folder)
    expect(a.status().options.peerId).toBe(peer)
    expect(
      await (await folder.getFileHandle('messages.json')).getFile().then((file) => file.text()),
    ).toBe(saved)
    const newFolder = new MockDir('other-conversation')
    await a.useFolder(folderHandle(newFolder))
    expect(a.status()).toMatchObject({
      activePeerId: another,
      options: { peerId: another },
      messages: 0,
      blockedReason: null,
    })
    const nextMeta = JSON.parse(
      await (await newFolder.getFileHandle('metadata.json')).getFile().then((file) => file.text()),
    )
    expect(nextMeta.peer_id).toBe(another)
    expect(a.previewMessages({ limit: 80 }).matching).toBe(0)
  } finally {
    globalThis.location.pathname = '/im/convo/' + peer
    await a.useFolder(folderHandle(folder))
  }
})

test('switching conversations while VK history is in flight cannot commit another chat', async () => {
  a = reload()
  await a.useFolder(folderHandle(folder))
  const saved = await (await folder.getFileHandle('messages.json')).getFile().then((file) => file.text())
  try {
    switchPeerDuringHistory = peer + 1
    await expect(
      a.run({ mode: 'recent', limit: 2, pageSize: 2, media: false, delay: 300 }),
    ).rejects.toThrow('другая переписка')
    expect(a.status().checkpoint?.status).toBe('paused')
    expect(
      await (await folder.getFileHandle('messages.json')).getFile().then((file) => file.text()),
    ).toBe(saved)
  } finally {
    switchPeerDuringHistory = null
    globalThis.location.pathname = '/im/convo/' + peer
  }
})

test('folder loading cannot expose mixed chat data or overlap with a new export', async () => {
  a = reload()
  await a.useFolder(folderHandle(folder))
  const pending = new MockDir('pending-safe-selection')
  const readFile = pending.getFileHandle.bind(pending)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  pending.getFileHandle = async (name, options = {}) => {
    if (name === 'metadata.json') await gate
    return readFile(name, options)
  }
  const loading = a.useFolder(folderHandle(pending))
  try {
    const state = a.status()
    expect(state.busy).toBe(true)
    expect(state.folder).toBeNull()
    expect(state.messages).toBe(0)
    expect(state.blockedReason).toContain('Читаю')
    await expect(
      a.run({ mode: 'recent', limit: 2, pageSize: 2, media: false, delay: 300 }),
    ).rejects.toThrow('Выбор папки')
  } finally {
    release()
  }
  await loading
  expect(a.status()).toMatchObject({ folder: pending.name, busy: false, messages: 0 })
  await a.useFolder(folderHandle(folder))
})

test('folder picker reserves the archive before user permission and rejects a changed VK conversation', async () => {
  a = reload()
  await a.useFolder(folderHandle(folder))
  const before = a.status()
  const nextFolder = new MockDir('different-peer-destination')
  const handle = Object.assign(folderHandle(nextFolder), {
    requestPermission: async (): Promise<PermissionState> => 'granted',
  })
  let select!: (folder: FileSystemDirectoryHandle) => void
  const picker = new Promise<FileSystemDirectoryHandle>((resolve) => {
    select = resolve
  })
  Object.assign(globalThis, { showDirectoryPicker: () => picker })
  const choosing = a.selectFolder()
  try {
    expect(a.status()).toMatchObject({
      busy: true,
      folderPending: true,
      folder: null,
      messages: 0,
    })
    expect(a.status().blockedReason).toContain('Выбор папки')
    await expect(a.run({ mode: 'recent', limit: 2 })).rejects.toThrow('Выбор папки')
    await expect(a.useFolder(folderHandle(folder))).rejects.toThrow('Другая операция')
    await expect(a.selectFolder()).rejects.toThrow('Другая операция')
    globalThis.location.pathname = '/im/convo/' + (peer + 1)
    select(handle)
    await expect(choosing).rejects.toThrow('Диалог VK изменился при выборе папки')
    expect(nextFolder.files.size).toBe(0)
    expect(a.status().busy).toBe(false)
    expect(a.status().folderPending).toBe(false)
    expect(a.status().options.peerId).toBe(peer)
    expect(a.status().messages).toBe(before.messages)
  } finally {
    select(handle)
    globalThis.location.pathname = '/im/convo/' + peer
    Object.assign(globalThis, { showDirectoryPicker: save.showDirectoryPicker })
  }
})

test('cancelling the folder picker restores the previously selected archive', async () => {
  a = reload()
  await a.useFolder(folderHandle(folder))
  const before = a.status()
  let rejectPicker!: (error: Error) => void
  const picker = new Promise<FileSystemDirectoryHandle>((_, reject) => {
    rejectPicker = reject
  })
  Object.assign(globalThis, { showDirectoryPicker: () => picker })
  const choosing = a.selectFolder()
  try {
    expect(a.status().folder).toBeNull()
    const cancel = new Error('User cancelled')
    cancel.name = 'AbortError'
    rejectPicker(cancel)
    await expect(choosing).rejects.toThrow('User cancelled')
    expect(a.status()).toMatchObject({
      busy: false,
      folderPending: false,
      folder: before.folder,
      messages: before.messages,
      options: { peerId: peer },
    })
  } finally {
    Object.assign(globalThis, { showDirectoryPicker: save.showDirectoryPicker })
  }
})
