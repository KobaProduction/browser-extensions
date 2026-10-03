import { describe, expect, test } from 'bun:test'
import { archiveRecordKind, buildArchiveThread } from '../packages/chatgpt/src/archive-records'
import {
  type ArchiveRecordView,
  captureRuleFor,
  captureRuleForOperation,
  DEFAULT_CAPTURE_RULE,
  DEFAULT_EXPORT_OPTIONS,
  dockFromDrop,
  dockPosition,
  mergeSettings,
  normalizeSettings,
  serverTimeMs,
  snapshotSettings,
} from '../packages/core/src'
import {
  type HistoryPageEvidence,
  historyCoverage,
} from '../packages/features/src/archive-coverage'
import { serializeArchiveExport } from '../packages/features/src/archive-export'
import { createArchivePackage } from '../packages/features/src/archive-package'
import { historyBackoffMs } from '../packages/features/src/history-loader'

function record(
  id: string,
  role: string,
  contentType = 'text',
  patch: Partial<ArchiveRecordView> = {},
): ArchiveRecordView {
  return {
    messageKey: `chat:${id}`,
    messageId: id,
    conversationId: 'chat',
    role,
    channel: role === 'assistant' ? 'final' : null,
    contentType,
    messageType: null,
    recipient: 'all',
    status: 'finished_successfully',
    modelSlug: null,
    parentId: null,
    turnExchangeId: null,
    createTime: 1,
    raw: { content: { content_type: contentType, parts: [id] } },
    ...patch,
  }
}
const page = (patch: Partial<HistoryPageEvidence> = {}): HistoryPageEvidence => ({
  readId: 'read',
  isInitial: true,
  requestedBefore: null,
  startCursor: 'm10',
  endCursor: 'm20',
  hasPreviousPage: true,
  hasNextPage: false,
  observedAt: 1,
  ...patch,
})

describe('dock persistence and settings migration', () => {
  test('defaults to the right edge; no pixel geometry remains authoritative', () => {
    const settings = normalizeSettings()
    expect(settings.launcher.side).toBe('right')
    expect(dockPosition('right', 0.5, 1200, 844)).toEqual({ x: 1156, y: 400 })
    expect(dockPosition('right', 0.5, 1200, 444)).toEqual({ x: 1156, y: 200 })
  })
  test('drop chooses nearest edge and clamps vertical ratio', () => {
    expect(dockFromDrop(100, 200, 1000, 444)).toEqual({ side: 'left', heightRatio: 0.5 })
    expect(dockFromDrop(800, 900, 1000, 444)).toEqual({ side: 'right', heightRatio: 1 })
  })
  test('schema migration preserves configured telemetry and denies unsolicited capture', () => {
    const previous = {
      ...normalizeSettings(),
      schemaVersion: 2,
      telemetry: { enabled: true, endpoint: 'https://example.test/otlp' },
    }
    expect(normalizeSettings(previous).telemetry.endpoint).toBe(previous.telemetry.endpoint)
    expect(normalizeSettings().archive.defaultRule.enabled).toBe(false)
  })
  test('scope patches preserve siblings and roundtrip export preferences', () => {
    let settings = mergeSettings(normalizeSettings(), {
      archive: { projects: { p1: { ...DEFAULT_CAPTURE_RULE, enabled: true } } },
    })
    settings = mergeSettings(settings, {
      archive: { conversations: { c1: { ...DEFAULT_CAPTURE_RULE, enabled: false } } },
      export: { format: 'markdown', level: 'custom' },
    })
    const saved = snapshotSettings(settings)
    expect(captureRuleFor(saved.archive, 'other', 'p1').enabled).toBe(true)
    expect(captureRuleFor(saved.archive, 'c1', 'p1').enabled).toBe(false)
    expect(saved.export.format).toBe('markdown')
    expect(saved.export.images).toBe(false)
  })
})

test('legacy pixel launcher geometry is discarded during schema 3 migration', () => {
  const migrated = normalizeSettings({
    schemaVersion: 2,
    launcher: { x: 1730, y: 812 } as never,
  })
  expect(migrated.launcher).toEqual({
    x: null,
    y: null,
    side: 'right',
    heightRatio: 0.65,
  })
})

describe('conversation vs nested records', () => {
  const records = [
    record('q', 'user'),
    record('r', 'assistant', 'thoughts', { parentId: 'q', channel: null }),
    record('call', 'assistant', 'text', { parentId: 'r', recipient: 'tools.read', channel: null }),
    record('result', 'tool', 'text', { parentId: 'call' }),
    record('a', 'assistant', 'text', { parentId: 'result' }),
    record('sys', 'system'),
  ]
  test('two visible replies, not six messages; all child records retained', () => {
    const thread = buildArchiveThread(records)
    expect(thread.messageCount).toBe(2)
    expect(thread.recordCount).toBe(6)
    expect(thread.detailCount).toBe(4)
    expect(thread.turns.find((turn) => turn.id === 'user:q')?.details.length).toBe(3)
  })
  test('deduplicates scoped record IDs, does not count status strings', () => {
    expect(buildArchiveThread([...records, ...records]).messageCount).toBe(2)
    expect(archiveRecordKind(record('ctx', 'assistant', 'model_editable_context'))).toBe('internal')
  })
  test('empty and hidden assistant records are not final replies', () => {
    expect(
      archiveRecordKind(record('e', 'assistant', 'text', { raw: { content: { parts: [''] } } })),
    ).toBe('internal')
    expect(
      archiveRecordKind(
        record('h', 'user', 'text', {
          raw: { metadata: { is_visually_hidden_from_conversation: true } },
        }),
      ),
    ).toBe('internal')
  })
  test('working-turn and turn-exchange IDs group records without using status', () => {
    const records = [
      record('user-a', 'user', 'text', { workingTurnId: 'work-a', turnExchangeId: 'turn-a' }),
      record('detail-a', 'assistant', 'thoughts', {
        workingTurnId: 'work-a',
        status: 'in_progress',
      }),
      record('answer-a', 'assistant', 'text', {
        turnExchangeId: 'turn-a',
        status: 'finished_successfully',
      }),
      record('unlinked', 'system', 'text', { status: 'finished_successfully' }),
    ]
    const thread = buildArchiveThread(records)
    const grouped = thread.turns.find((turn) => turn.id === 'user:user-a')
    expect(grouped?.messages.map((item) => item.record.messageId).sort()).toEqual([
      'answer-a',
      'user-a',
    ])
    expect(grouped?.details.map((item) => item.record.messageId)).toEqual(['detail-a'])
    expect(thread.turns.find((turn) => turn.id === 'unassigned')?.association).toBe('unassigned')
  })

  test('handles parent cycles without recursion', () => {
    const thread = buildArchiveThread([
      record('a', 'tool', 'text', { parentId: 'b' }),
      record('b', 'tool', 'text', { parentId: 'a' }),
    ])
    expect(thread.recordCount).toBe(2)
    expect(thread.messageCount).toBe(0)
  })
  test('server seconds and observed milliseconds sort on the same scale', () => {
    expect(serverTimeMs(1700000000)).toBe(1700000000000)
    expect(serverTimeMs(null, 1700000001000)).toBe(1700000001000)
  })
  test('basic JSON excludes internal records and raw metadata', () => {
    const json = serializeArchiveExport(
      { conversationId: 'chat', title: 'Test', projectId: null },
      buildArchiveThread(records),
      DEFAULT_EXPORT_OPTIONS,
      { verified: false },
    ).text
    const exported = JSON.parse(json)
    expect(exported.turns.flatMap((turn: { details: unknown[] }) => turn.details)).toEqual([])
    expect(json.includes('finished_successfully')).toBe(false)
    expect(exported.binaryAttachmentsIncluded).toBe(false)
  })
  test('custom Markdown includes only selected reasoning, not tool outputs', () => {
    const text = serializeArchiveExport(
      { conversationId: 'chat', title: 'Test', projectId: null },
      buildArchiveThread(records),
      {
        ...DEFAULT_EXPORT_OPTIONS,
        level: 'custom',
        format: 'markdown',
        tools: false,
        reasoning: true,
      },
      {},
    ).text
    expect(text).toContain('### reasoning')
    expect(text).not.toContain('### tool_result')
  })
  test('full transcript retains raw records but package truthfully reports missing assets', async () => {
    const attachment = record('attachment', 'user', 'multimodal_text', {
      raw: {
        id: 'attachment',
        author: { role: 'user' },
        content: {
          content_type: 'multimodal_text',
          parts: [
            {
              content_type: 'image_asset_pointer',
              asset_pointer: 'sediment://file_fixture',
              mime_type: 'image/png',
              size_bytes: 3,
              width: 1,
              height: 1,
            },
            'caption',
          ],
        },
        metadata: { attachments: [{ id: 'file_fixture', name: 'fixture.png' }] },
      },
    })
    const thread = buildArchiveThread([attachment])
    const full = { ...DEFAULT_EXPORT_OPTIONS, level: 'full' as const }
    const transcript = serializeArchiveExport(
      { conversationId: 'chat', title: 'Test', projectId: null },
      thread,
      full,
      {},
    ).text
    expect(transcript).toContain('originalRecord')
    const conversation = {
      conversationId: 'chat',
      projectId: null,
      title: 'Test',
    } as never
    const missing = await createArchivePackage(conversation, thread, full, {}, [])
    expect(missing.manifest.complete).toBe(false)
    expect(missing.manifest.assets[0]?.status).toBe('missing_url')
    expect(missing.blob.type).toBe('application/zip')
  })

  test('custom binary package excludes attachments from unselected nested records', async () => {
    const tool = record('tool-attachment', 'tool', 'text', {
      raw: {
        id: 'tool-attachment',
        author: { role: 'tool', name: 'fixture.tool' },
        content: {
          content_type: 'multimodal_text',
          parts: [
            {
              content_type: 'file_asset_pointer',
              asset_pointer: 'sediment://file_tool_hidden',
              mime_type: 'application/octet-stream',
              size_bytes: 3,
            },
          ],
        },
        metadata: { attachments: [{ id: 'file_tool_hidden', name: 'hidden.bin' }] },
      },
    })
    const thread = buildArchiveThread([
      record('user-visible', 'user', 'text'),
      tool,
      record('answer-visible', 'assistant', 'text'),
    ])
    const result = await createArchivePackage(
      { conversationId: 'chat', projectId: null, title: 'Test' } as never,
      thread,
      {
        ...DEFAULT_EXPORT_OPTIONS,
        level: 'custom',
        tools: false,
        internal: false,
        reasoning: false,
        files: true,
      },
      { verified: true, capture: { verified: true } },
      [
        {
          assetId: 'file_tool_hidden',
          fileName: 'hidden.bin',
          mimeType: 'application/octet-stream',
          sizeBytes: 3,
          width: null,
          height: null,
          kind: 'file',
          downloadUrl:
            'https://chatgpt.com/backend-api/estuary/content?id=file_tool_hidden&sig=test',
          resolverObservedAt: 1,
          firstSeenAt: 1,
          lastSeenAt: 1,
        },
      ],
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    )
    expect(result.manifest.assets).toEqual([])
    expect(result.manifest.complete).toBe(true)
  })

  test('full package includes verified bytes and SHA-256 when a signed asset URL is available', async () => {
    const attachment = record('attachment', 'user', 'multimodal_text', {
      raw: {
        id: 'attachment',
        author: { role: 'user' },
        content: {
          content_type: 'multimodal_text',
          parts: [
            {
              content_type: 'image_asset_pointer',
              asset_pointer: 'sediment://file_fixture',
              mime_type: 'image/png',
              size_bytes: 3,
            },
          ],
        },
        metadata: { attachments: [{ id: 'file_fixture', name: 'fixture.png' }] },
      },
    })
    const thread = buildArchiveThread([attachment])
    const result = await createArchivePackage(
      { conversationId: 'chat', projectId: null, title: 'Test' } as never,
      thread,
      { ...DEFAULT_EXPORT_OPTIONS, level: 'full' },
      { verified: true, capture: { verified: true } },
      [
        {
          assetId: 'file_fixture',
          fileName: 'fixture.png',
          mimeType: 'image/png',
          sizeBytes: 3,
          width: null,
          height: null,
          kind: 'image',
          downloadUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file_fixture&sig=test',
          resolverObservedAt: 1,
          firstSeenAt: 1,
          lastSeenAt: 1,
        },
      ],
      async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    )
    expect(result.manifest.complete).toBe(true)
    expect(result.manifest.assets[0]?.status).toBe('included')
    expect(result.manifest.assets[0]?.sha256).toHaveLength(64)
    const zip = new Uint8Array(await result.blob.arrayBuffer())
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
  })
})
describe('fresh contiguous pagination evidence', () => {
  test('oldest page alone does not prove complete history', () => {
    expect(
      historyCoverage([page({ isInitial: false, hasPreviousPage: false, hasNextPage: true })])
        .verified,
    ).toBe(false)
  })
  test('initial complete page proves current history snapshot', () => {
    expect(historyCoverage([page({ hasPreviousPage: false })]).verified).toBe(true)
  })
  test('missing middle page prevents completion', () => {
    expect(
      historyCoverage([
        page(),
        page({
          isInitial: false,
          requestedBefore: 'm5',
          startCursor: 'm0',
          hasPreviousPage: false,
        }),
      ]).verified,
    ).toBe(false)
  })
  test('all linked pages from one read prove history to beginning', () => {
    expect(
      historyCoverage([
        page(),
        page({
          isInitial: false,
          requestedBefore: 'm10',
          startCursor: 'm0',
          hasPreviousPage: false,
          observedAt: 2,
        }),
      ]).verified,
    ).toBe(true)
  })
  test('a new incomplete read invalidates stale completion', () => {
    expect(
      historyCoverage([page({ hasPreviousPage: false }), page({ readId: 'new', observedAt: 3 })])
        .verified,
    ).toBe(false)
  })
})

describe('regressions: policy and read identity', () => {
  test('chat override can be removed to inherit project policy', () => {
    const settings = normalizeSettings()
    const configured = mergeSettings(settings, {
      archive: {
        projects: { project: { ...DEFAULT_CAPTURE_RULE, enabled: true } },
        conversations: { chat: { ...DEFAULT_CAPTURE_RULE, enabled: false } },
      },
    })
    expect(captureRuleFor(configured.archive, 'chat', 'project').enabled).toBe(false)
    const inherited = mergeSettings(configured, { archive: { conversations: { chat: null } } })
    expect(captureRuleFor(inherited.archive, 'chat', 'project').enabled).toBe(true)
    expect(Object.hasOwn(inherited.archive.conversations, 'chat')).toBe(false)
  })
  test('malformed settings do not turn a string into capture consent', () => {
    const settings = normalizeSettings({ archive: { defaultRule: { enabled: 'true' } } } as never)
    expect(settings.archive.defaultRule.enabled).toBe(false)
    const defaults = normalizeSettings()
    expect(Object.keys(defaults.export).sort()).toEqual([
      'files',
      'format',
      'images',
      'internal',
      'level',
      'reasoning',
      'tools',
    ])
  })
  test('late response from an older read cannot prove a newer incomplete read', () => {
    const old = {
      readId: 'old',
      readStartedAt: 10,
      isInitial: true,
      requestedBefore: null,
      startCursor: 'old-start',
      endCursor: 'old-end',
      hasPreviousPage: false,
      hasNextPage: false,
      observedAt: 100,
    }
    const newer = {
      ...old,
      readId: 'new',
      readStartedAt: 20,
      hasPreviousPage: true,
      startCursor: 'new-start',
      observedAt: 50,
    }
    const result = historyCoverage([newer, old])
    expect(result.verified).toBe(false)
    expect(result.readId).toBe('new')
    expect(result.readStartedAt).toBe(20)
  })
})

describe('history loader retry policy', () => {
  test('429 has a bounded longer delay while ordinary errors use capped exponential backoff', () => {
    expect(historyBackoffMs(429, 1)).toBe(12_000)
    expect(historyBackoffMs(0, 1)).toBe(2_000)
    expect(historyBackoffMs(500, 3)).toBe(8_000)
    expect(historyBackoffMs(500, 8)).toBe(8_000)
  })
})

describe('resume regressions: consent, evidence and export boundaries', () => {
  test('manual capture bypasses enablement but preserves category choices', () => {
    const settings = mergeSettings(normalizeSettings(), {
      archive: {
        projects: {
          project: {
            enabled: false,
            reasoning: false,
            tools: true,
            internal: false,
          },
        },
      },
    })
    expect(captureRuleForOperation(settings.archive, 'chat', 'project', true, false)).toEqual({
      enabled: true,
      reasoning: false,
      tools: true,
      internal: false,
    })
    expect(captureRuleForOperation(settings.archive, 'chat', 'project', false, true).enabled).toBe(
      false,
    )
    expect(captureRuleForOperation(settings.archive, 'other', null, false, true).enabled).toBe(
      false,
    )
  })
  test('same read and request time uses the latest observed initial evidence', () => {
    const older = page({ readStartedAt: 10, observedAt: 20, hasPreviousPage: false })
    const latest = page({ readStartedAt: 10, observedAt: 30, hasPreviousPage: true })
    expect(historyCoverage([older, latest]).verified).toBe(false)
    expect(historyCoverage([latest, older]).verified).toBe(false)
  })
  test('server retry cannot reuse an unrelated read to close a pagination gap', () => {
    expect(
      historyCoverage([
        page({ readId: 'new', readStartedAt: 10 }),
        page({
          readId: 'old',
          readStartedAt: 1,
          isInitial: false,
          requestedBefore: 'm10',
          startCursor: 'm0',
          hasPreviousPage: false,
        }),
      ]).verified,
    ).toBe(false)
  })
  test('conversation projection does not leak storage raw into any export level', () => {
    const stored = {
      conversationId: 'chat',
      title: 'Test',
      projectId: null,
      raw: { internal_context: 'PRIVATE_STORAGE_ONLY' },
      owner: 'PRIVATE_OWNER',
    }
    for (const level of ['conversation', 'custom'] as const) {
      const text = serializeArchiveExport(
        stored,
        buildArchiveThread([record('u', 'user')]),
        { ...DEFAULT_EXPORT_OPTIONS, level },
        { verified: false },
      ).text
      expect(text).not.toContain('PRIVATE_STORAGE_ONLY')
      expect(text).not.toContain('PRIVATE_OWNER')
      expect(JSON.parse(text).conversation).toEqual({
        conversationId: 'chat',
        title: 'Test',
        projectId: null,
      })
    }
  })
})
