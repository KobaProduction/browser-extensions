import { createArchiveFiles } from '@kobaproduction/browser-adapters'
import { scanLinearArchive } from '@kobaproduction/browser-archive'
import { assets, download as downloadVkAsset } from '../api/vk-media'
import { createVkProvider } from '../api/vk-provider'
import { selectVkArchivePreview } from './archive-preview'
import { archiveContextBlock, conversationPeerFromPath } from './conversation-context'
import { viewerHTML } from './offline-viewer'
import type {
  ArchiveApi,
  ArchiveOptions,
  ArchiveProgress,
  ArchiveRunResult,
  ArchiveStatus,
  VkArchiveMeta,
  VkAttachmentView,
  VkCheckpoint,
  VkMessage,
} from './types'
/* VK Booster v2 provider composition; neutral paging, storage and UI live in shared packages. */
export function installVkArchive(): void {
  const VERSION = '2.3.1'
  if (globalThis.VKExport?.version === VERSION) return
  const currentPeer = () => conversationPeerFromPath(location.pathname)
  const cfg: ArchiveOptions = {
    peerId: currentPeer() ?? 0,
    mode: 'recent',
    limit: 10,
    from: '',
    through: '',
    pageSize: 50,
    delay: 450,
    media: true,
  }
  let root: FileSystemDirectoryHandle | null = null,
    meta: VkArchiveMeta | null = null,
    rows: VkMessage[] = [],
    busy = false,
    stopRequested = false,
    folderLoading = false
  let prog: ArchiveProgress = {
    phase: 'Ожидание',
    done: 0,
    total: 0,
    newCount: 0,
    downloaded: 0,
    failed: 0,
  }
  const subscribers = new Set<(status: ArchiveStatus) => void>()
  const ts = () => new Date().toISOString(),
    sleep = (ms: number): Promise<void> =>
      globalThis.__VK_EXPORT_TEST_MODE ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))
  const validDay = (d: string): boolean =>
    !d ||
    (/^\d{4}-\d\d-\d\d$/.test(d) &&
      new Date(Date.parse(d + 'T00:00:00+03:00') + 10800000).toISOString().slice(0, 10) === d)
  const unixDay = (d: string): number | null =>
    d ? Math.floor(Date.parse(d + 'T00:00:00+03:00') / 1000) : null
  const known = () => new Map<number, VkMessage>(rows.map((m) => [m.id, m]))
  const blank = (): VkArchiveMeta => ({
    schema: 2,
    version: VERSION,
    peer_id: cfg.peerId,
    updated: ts(),
    total: 0,
    checkpoint: null,
    files: {},
    runs: [],
    conversation: null,
  })
  const { json, write, dir } = createArchiveFiles(() => {
    if (!root) throw Error('Сначала выбери папку')
    return root
  })
  const sorted = () => rows.sort((a, b) => a.date - b.date || a.id - b.id)
  const currentMeta = (): VkArchiveMeta => {
    if (!meta) throw Error('Архив не выбран')
    return meta
  }
  async function persistSnapshot(
    nextRows: VkMessage[],
    nextMeta: VkArchiveMeta,
  ): Promise<{ ordered: VkMessage[]; savedMeta: VkArchiveMeta }> {
    const ordered = [...nextRows].sort((a, b) => a.date - b.date || a.id - b.id)
    const lastMessage = ordered.at(-1)
    const savedMeta = {
      ...nextMeta,
      total: ordered.length,
      updated: ts(),
      lastMessageDate: lastMessage ? new Date(lastMessage.date * 1000).toISOString() : null,
    }
    await write('messages.json', { schema: 2, peer_id: cfg.peerId, messages: ordered })
    await write('metadata.json', savedMeta)
    return { ordered, savedMeta }
  }
  async function checkpoint() {
    const { ordered, savedMeta } = await persistSnapshot(rows, currentMeta())
    rows = ordered
    meta = savedMeta
    refresh()
  }
  function status(): ArchiveStatus {
    const pagePeer = currentPeer()
    if (folderLoading)
      return {
        version: VERSION,
        folder: null,
        activePeerId: pagePeer,
        blockedReason: 'Читаю и проверяю папку архива…',
        busy: true,
        options: { ...cfg },
        progress: { ...prog },
        messages: 0,
        checkpoint: null,
      }
    if (!root && !busy && pagePeer !== null) cfg.peerId = pagePeer
    return {
      version: VERSION,
      folder: root?.name || null,
      activePeerId: pagePeer,
      blockedReason: archiveContextBlock(cfg.peerId, pagePeer),
      busy,
      options: { ...cfg },
      progress: { ...prog },
      messages: rows.length,
      checkpoint: meta?.checkpoint || null,
    }
  }
  function configure(v: Partial<ArchiveOptions> = {}): ArchiveStatus {
    if (busy || folderLoading) throw Error('Заверши текущую операцию с архивом')
    const pagePeer = currentPeer()
    const o = { ...cfg, ...v, peerId: v.peerId ?? (root ? cfg.peerId : (pagePeer ?? cfg.peerId)) }
    if (pagePeer !== null && o.peerId !== pagePeer) throw Error('Выбран другой диалог VK')
    if (!['recent', 'incremental', 'backfill'].includes(o.mode)) throw Error('Режим')
    if (!Number.isSafeInteger(o.limit) || o.limit < 1 || o.limit > 100000)
      throw Error('Количество: 1–100000')
    if (!Number.isSafeInteger(o.pageSize) || o.pageSize < 1 || o.pageSize > 100)
      throw Error('Пачка: 1–100')
    if (!Number.isSafeInteger(o.delay) || o.delay < 300) throw Error('Пауза: от 300 мс')
    if (!validDay(o.from) || !validDay(o.through) || (o.from && o.through && o.from > o.through))
      throw Error('Диапазон дат')
    if (root && o.peerId !== currentMeta().peer_id)
      throw Error('Для другого диалога нужна отдельная папка')
    Object.assign(cfg, o)
    return status()
  }
  function isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  }
  function isMessage(v: unknown): v is VkMessage {
    return (
      isRecord(v) &&
      typeof v.id === 'number' &&
      Number.isSafeInteger(v.id) &&
      typeof v.date === 'number' &&
      Number.isFinite(v.date)
    )
  }
  function isMeta(v: unknown): v is VkArchiveMeta {
    return (
      isRecord(v) &&
      v.schema === 2 &&
      typeof v.peer_id === 'number' &&
      isRecord(v.files) &&
      Array.isArray(v.runs) &&
      (v.checkpoint === null || isRecord(v.checkpoint))
    )
  }
  function isMessagesFile(v: unknown): v is { schema: 2; peer_id: number; messages: VkMessage[] } {
    return (
      isRecord(v) &&
      v.schema === 2 &&
      typeof v.peer_id === 'number' &&
      Array.isArray(v.messages) &&
      v.messages.every(isMessage)
    )
  }
  async function useFolder(handle: FileSystemDirectoryHandle): Promise<ArchiveStatus> {
    const pagePeer = currentPeer()
    if (pagePeer === null) throw Error('Открой диалог VK перед выбором папки')
    if (busy || folderLoading) throw Error('Другая операция с папкой уже выполняется')
    const previousRoot = root,
      previousMeta = meta,
      previousRows = rows,
      previousPeer = cfg.peerId
    folderLoading = true
    cfg.peerId = pagePeer
    root = handle
    try {
      const previous = await json('metadata.json')
      if (!previous) {
        // v1 stores state.json and pages; reject before creating v2 files.
        try {
          await root.getFileHandle('state.json')
          throw Error('Обнаружен старый архив v1. Используй отдельную утилиту миграции.')
        } catch (e) {
          if (!(e instanceof Error) || e.name !== 'NotFoundError') throw e
        }
        try {
          await root.getDirectoryHandle('pages')
          throw Error('Обнаружен старый каталог pages/. Сначала выполни миграцию.')
        } catch (e) {
          if (!(e instanceof Error) || e.name !== 'NotFoundError') throw e
        }
      }
      const loadedMeta = previous === null ? blank() : isMeta(previous) ? previous : null
      if (!loadedMeta || loadedMeta.peer_id !== cfg.peerId)
        throw Error('Старая папка несовместима. Мигрируй её отдельной утилитой в новую папку.')
      const existing = await json('messages.json')
      const loadedMessages =
        existing === null
          ? []
          : isMessagesFile(existing) && existing.peer_id === cfg.peerId
            ? existing.messages
            : null
      if (!loadedMessages) throw Error('Неверный формат messages.json')
      meta = loadedMeta
      rows = loadedMessages
      sorted()
      if (currentPeer() !== pagePeer) throw Error('Диалог VK изменился при выборе папки')
      if (!previous) await checkpoint()
      folderLoading = false
      refresh()
      return status()
    } catch (error) {
      // Failed selection must never redirect the old archive state into a new folder.
      root = previousRoot
      meta = previousMeta
      rows = previousRows
      cfg.peerId = previousPeer
      folderLoading = false
      refresh()
      throw error
    } finally {
      folderLoading = false
    }
  }
  async function selectFolder(): Promise<ArchiveStatus> {
    if (!globalThis.showDirectoryPicker) throw Error('Нужен Chrome и HTTPS')
    // This must run synchronously from a real user button click.
    const h = await globalThis.showDirectoryPicker({ id: 'vk-archive-v2', mode: 'readwrite' })
    const permitted = h as FileSystemDirectoryHandle & {
      requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
    }
    if ((await permitted.requestPermission({ mode: 'readwrite' })) !== 'granted')
      throw Error('Нет разрешения на запись')
    return useFolder(h)
  }
  const vk = createVkProvider(cfg, { sleep, refresh })
  const auth = () => vk.auth()
  const history = (offset: number, count: number) => vk.history(offset, count)
  const api = (method: string, p: Record<string, string | number>) => vk.api(method, p)
  const download = (a: ReturnType<typeof assets>[number]) =>
    downloadVkAsset(a, { meta: currentMeta(), dir, write, sleep })
  function attachmentView(m: VkMessage): VkAttachmentView[] {
    return assets(m).map((a) => ({
      type: a.type,
      key: a.key,
      media: currentMeta().files[a.key]?.path || null,
      status: currentMeta().files[a.key]?.status || 'missing',
      external: a.external,
      transcript: a.transcript,
      name: currentMeta().files[a.key]?.name || a.choices[0]?.name || a.type,
    }))
  }
  // Local file:// pages cannot fetch JSON from neighbouring files without browser flags.
  // Embed a *render-only* snapshot in index.html; messages.json remains authoritative.
  async function buildViewer() {
    sorted()
    await write('index.html', viewerHTML(rows, cfg.peerId, attachmentView))
    return { messages: rows.length }
  }
  function progress(
    phase: string,
    done: number,
    total: number,
    extra: Partial<ArchiveProgress> = {},
  ): void {
    prog = { phase, done, total, ...extra }
    refresh()
  }
  function stop() {
    stopRequested = true
    refresh()
  }
  async function run(
    options: Partial<ArchiveOptions> & { resume?: boolean } = {},
  ): Promise<ArchiveRunResult> {
    if (busy) throw Error('Выгрузка уже запущена')
    if (folderLoading) throw Error('Выбор папки ещё не завершён')
    if (!root) throw Error('Сначала выбери папку')
    const resume = options.resume === true
    if (!resume) configure(options)
    const guard = () => {
      const reason = archiveContextBlock(cfg.peerId, currentPeer())
      if (reason || currentMeta().peer_id !== cfg.peerId)
        throw Error(reason ?? 'Папка принадлежит другому диалогу VK')
    }
    guard()
    if (!(await auth())) throw Error('Не удалось авторизовать VK API из хранилища')
    guard()
    busy = true
    stopRequested = false
    const storedSettings = currentMeta().checkpoint?.settings
    if (resume && storedSettings) Object.assign(cfg, storedSettings)
    let index = known()
    const identities = new Set([...index.keys()].map(String))
    const lower = unixDay(cfg.from),
      through = unixDay(cfg.through),
      upper = through === null ? null : through + 86400
    const countTarget = cfg.limit
    const savedCp = currentMeta().checkpoint
    let cp: VkCheckpoint =
      resume && savedCp && ['paused', 'running'].includes(savedCp.status)
        ? savedCp
        : {
            mode: cfg.mode,
            target: countTarget,
            offset: cfg.mode === 'backfill' ? currentMeta().backfillOffset || 0 : 0,
            matched: 0,
            scanned: 0,
            newCount: 0,
            phase: 'messages',
            fileCursor: 0,
            status: 'running',
            totalVK: null,
            started: ts(),
            settings: { ...cfg },
          }
    currentMeta().checkpoint = cp
    cfg.mode = cp.mode
    progress('Сообщения', cp.matched, cp.target)
    try {
      if (!currentMeta().conversation && vk.hasToken()) {
        try {
          currentMeta().conversation = await api('messages.getConversationsById', {
            peer_ids: String(cfg.peerId),
            extended: 0,
          })
        } catch {}
      }
      if (cp.phase === 'messages') {
        const result = await scanLinearArchive<VkMessage>({
          mode: cp.mode,
          target: cp.target,
          pageSize: cfg.pageSize,
          knownKeys: identities,
          keyOf: (m) => String(m.id),
          timestampOf: (m) => m.date,
          fromInclusive: lower,
          toExclusive: upper,
          initial: {
            offset: cp.offset,
            matched: cp.matched,
            scanned: cp.scanned,
            newCount: cp.newCount,
          },
          source: {
            async readPage(offset, count) {
              guard()
              const page = await history(offset, count)
              guard()
              return page
            },
          },
          stopped: () => stopRequested,
          delay: () => sleep(cfg.delay),
          async commit({ selection, next, sourceTotal }) {
            guard()
            const candidateIndex = new Map(index)
            for (const item of selection.added) candidateIndex.set(item.id, item)
            const nextCp: VkCheckpoint = {
              ...cp,
              totalVK: sourceTotal,
              offset: next.offset,
              matched: next.matched,
              scanned: next.scanned,
              newCount: next.newCount,
              shifted: next.newCount,
              status: 'running',
            }
            let backfillOffset = currentMeta().backfillOffset || 0
            if (cp.mode === 'backfill') backfillOffset = next.offset
            if (cp.mode === 'incremental') backfillOffset += next.newCount - (cp.shifted || 0)
            if (cp.mode === 'recent') backfillOffset = Math.max(backfillOffset, next.offset)
            const { ordered, savedMeta } = await persistSnapshot([...candidateIndex.values()], {
              ...currentMeta(),
              backfillOffset,
              checkpoint: nextCp,
            })
            // Only publish the page and its checkpoint after the folder driver acknowledges both writes.
            index = candidateIndex
            rows = ordered
            meta = savedMeta
            cp = nextCp
            refresh()
            progress('Сообщения', cp.matched, cp.target, { newCount: cp.newCount, scanned: cp.scanned })
          },
        })
        if (result.sourceTotal !== null) cp.totalVK = result.sourceTotal
        if (!result.paused) cp.phase = 'media'
      }
      if (stopRequested) {
        cp.status = 'paused'
        await checkpoint()
        return { paused: true, progress: status().progress }
      }
      if (cp.phase === 'media') {
        const queue = cfg.media ? rows.flatMap(assets).filter((a) => a.type !== 'link') : []
        progress('Файлы', cp.fileCursor, queue.length, { newCount: cp.newCount })
        for (let i = cp.fileCursor; i < queue.length; i++) {
          if (stopRequested) break
          guard()
          const asset = queue[i]
          if (!asset) throw Error('Недоступен файл из очереди')
          const outcome = await download(asset)
          cp.fileCursor = i + 1
          currentMeta().checkpoint = cp
          await write('metadata.json', currentMeta()) // file-by-file resume; messages are not re-written
          const vals = Object.values(currentMeta().files)
          progress('Файлы', cp.fileCursor, queue.length, {
            downloaded: vals.filter((f) => f.status === 'saved').length,
            failed: vals.filter((f) => f.status === 'failed').length,
            newCount: cp.newCount,
          })
          if (!stopRequested && outcome !== 'existing') await sleep(250)
        }
      }
      if (stopRequested) {
        cp.status = 'paused'
        await checkpoint()
        return { paused: true, progress: status().progress }
      }
      guard()
      cp.status = 'done'
      cp.phase = 'done'
      cp.finished = ts()
      currentMeta().checkpoint = cp
      currentMeta().runs.push({
        mode: cp.mode,
        target: cp.target,
        matched: cp.matched,
        newCount: cp.newCount,
        finished: ts(),
      })
      if (currentMeta().runs.length > 30) currentMeta().runs = currentMeta().runs.slice(-30)
      await checkpoint()
      await buildViewer()
      progress('Готово', cp.target, cp.target, {
        newCount: cp.newCount,
        downloaded: Object.values(currentMeta().files).filter((f) => f.status === 'saved').length,
      })
      return {
        matched: cp.matched,
        newCount: cp.newCount,
        saved: rows.length,
        files: prog.downloaded ?? 0,
        folder: root.name,
      }
    } catch (e) {
      cp.status = 'paused'
      cp.error = String(e instanceof Error ? e.message : e).slice(0, 180)
      try {
        await checkpoint()
      } catch {}
      progress('Ошибка', cp.matched, cp.target, { error: cp.error })
      throw e
    } finally {
      busy = false
      refresh()
    }
  }
  function refresh() {
    const snapshot = status()
    for (const listener of subscribers)
      try {
        listener(snapshot)
      } catch {}
  }
  function subscribe(listener: (status: ArchiveStatus) => void): () => void {
    subscribers.add(listener)
    listener(status())
    return () => subscribers.delete(listener)
  }
  function show() {
    window.dispatchEvent(new CustomEvent('koba:open-feature', { detail: { id: 'vk-booster' } }))
  }
  function hide() {
    /* Single control-center shell owns visibility. */
  }
  const apiObject: ArchiveApi = {
    version: VERSION,
    configure,
    selectFolder,
    useFolder,
    run,
    resume: () => run({ resume: true }),
    stop,
    status,
    show,
    hide,
    subscribe,
    buildViewer,
    getMessages: () => [...rows],
    previewMessages: (options) => selectVkArchivePreview(rows, options),
    destroy() {
      subscribers.clear()
      if (globalThis.VKExport === apiObject) delete globalThis.VKExport
    },
  }
  globalThis.VKExport = Object.freeze(apiObject)
  // Entry points live in @kobaproduction/browser-ui and target adapters.
}
