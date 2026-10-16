import { expect, test } from 'bun:test'
import {
  DEFAULT_CAPTURE_RULE,
  mergeSettings,
  normalizeSettings,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { Window } from 'happy-dom'
import { ArchiveCollectionSession } from '../packages/features/src/archive-collection-session'
import { FixedChatGptCapture } from '../packages/features/src/archive-fixed-runtime'
import {
  ArchiveContractError,
  ArchiveSourceGate,
  NATIVE_HISTORY_CONTRACT_V3,
  NATIVE_HISTORY_CONTRACT_V4,
} from '../packages/features/src/archive-source-contract'
import { ChatGptConversationAutomation } from '../packages/features/src/conversation-automation'
import { ConversationStateStore } from '../packages/features/src/conversation-state'
import type { ConversationStreamEventDetail } from '../packages/observer/src'
import { installSyntheticAudio } from './fixtures/synthetic-audio'

/** Generated data matching observed shapes; streaming placement differs from stored ancestry. */
function record(id: string, role: string, text: string) {
  return {
    id,
    author: { role, metadata: {} },
    create_time: 1_800_000_000,
    update_time: null,
    weight: 1,
    recipient: 'all',
    channel: role === 'assistant' ? 'final' : null,
    status: 'finished_successfully',
    end_turn: role === 'assistant',
    content: { content_type: 'text', parts: [text] },
    metadata: { parent_id: role === 'assistant' ? 'synthetic-user' : null },
  }
}

test.each([NATIVE_HISTORY_CONTRACT_V3, NATIVE_HISTORY_CONTRACT_V4])(
  '%s source gate controls actual state, fixed capture and message-trigger sound together',
  async (version) => {
    const accepted = version === NATIVE_HISTORY_CONTRACT_V4
    const conversationId = accepted ? 'synthetic-v4-pipeline' : 'synthetic-v3-pipeline'
    const ownerId = `owner-${conversationId}`
    const dom = new Window({ url: `https://chatgpt.com/c/${conversationId}` })
    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      location: globalThis.location,
      CustomEvent: globalThis.CustomEvent,
    }
    Object.assign(globalThis, {
      window: dom,
      document: dom.document,
      location: dom.location,
      CustomEvent: dom.CustomEvent,
    })
    const audio = installSyntheticAudio()
    const gate = new ArchiveSourceGate(false, version)
    const state = new ConversationStateStore(dom as unknown as globalThis.Window, gate)
    state.ingestAccount({ accountId: ownerId, observedAt: 1 })
    const stored = mergeSettings(normalizeSettings(), {
      archive: { defaultRule: { ...DEFAULT_CAPTURE_RULE, enabled: true } },
      automation: {
        enabled: true,
        rules: [
          {
            id: 'source-message-sound',
            label: 'Synthetic message sound',
            enabled: true,
            trigger: {
              type: 'message',
              role: 'assistant',
              pattern: { kind: 'exact', value: 'SYNTHETIC_V4_READY' },
            },
            actions: [{ type: 'play-sound', tone: 'chime' }],
            cooldownMs: 0,
          },
        ],
      },
    })
    const settings = {
      get: async () => structuredClone(stored),
      subscribe: () => () => undefined,
    } as unknown as SettingsAdapter
    const capture = new FixedChatGptCapture(
      state,
      settings,
      'Tampermonkey',
      new ArchiveCollectionSession(),
      { indexedDB, IDBKeyRange },
    )
    const automation = new ChatGptConversationAutomation(state, settings, capture)
    const initial = [
      record('synthetic-user', 'user', 'Synthetic request'),
      record('synthetic-system', 'system', 'Synthetic system context'),
    ]
    try {
      state.ingestPage({
        kind: 'conversation-page',
        accountId: ownerId,
        conversationId,
        readId: 'synthetic-read',
        readStartedAt: 2,
        isInitial: true,
        requestedBefore: null,
        timestamp: 3,
        sourceUrl: `https://chatgpt.com/backend-api/conversations/${conversationId}`,
        payload: {
          conversation_id: conversationId,
          title: 'Synthetic source adapter validation',
          messages: initial,
          page_info: {
            start_cursor: null,
            end_cursor: null,
            has_previous_page: false,
            has_next_page: false,
          },
        },
      })
      capture.start()
      await automation.start()
      expect(await capture.savedCurrent()).toBe(2)
      state.ingestRequest({
        accountId: ownerId,
        conversationId,
        requestId: 'synthetic-stream-run',
        userMessageId: 'synthetic-user',
        startedAt: 4,
        observedAt: 4,
        source: 'request_observed_at',
      })
      const assistant = {
        ...record('synthetic-assistant', 'assistant', 'SYNTHETIC_V4_READY'),
        metadata: {
          parent_id: 'synthetic-user',
          streaming_parent_id: 'synthetic-stream-placement',
          streaming_parent_revision: 0,
          model_dil_v2: {},
          view_state: {},
        },
      }
      const original = JSON.stringify(assistant)
      const event: ConversationStreamEventDetail = {
        accountId: ownerId,
        conversationId,
        requestId: 'synthetic-stream-run',
        userMessageId: 'synthetic-user',
        kind: 'message',
        record: assistant,
        observedAt: 5,
      }
      if (accepted) state.ingestStreamEvent(event)
      else expect(() => state.ingestStreamEvent(event)).toThrow(ArchiveContractError)
      const saved = await capture.readConversation(conversationId)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(JSON.stringify(assistant)).toBe(original)
      expect(saved).toHaveLength(accepted ? 3 : 2)
      expect(audio.contexts).toHaveLength(accepted ? 1 : 0)
      if (accepted) {
        expect(gate.get(conversationId)).toBeUndefined()
        expect(state.getMessage(conversationId, assistant.id)?.raw).toBe(assistant)
        expect(state.lifecycle(conversationId)?.state).toBe('complete')
        expect(saved.find((entry) => entry.id === assistant.id)?.raw).toEqual(assistant)
        expect(audio.contexts[0]?.frequencies).toEqual([660, 880])
        const versions = await capture.messageVersions(conversationId, assistant.id)
        const firstVersion = versions[0]
        if (!firstVersion) throw Error('Expected retained source version')
        expect(firstVersion.sourceVersion).toBe(NATIVE_HISTORY_CONTRACT_V4)
        expect((firstVersion.raw as typeof assistant).metadata.parent_id).toBe('synthetic-user')
        expect((firstVersion.raw as typeof assistant).metadata.streaming_parent_id).toBe(
          'synthetic-stream-placement',
        )
      } else {
        expect(state.getMessage(conversationId, assistant.id)).toBeUndefined()
        expect(gate.get(conversationId)).toMatchObject({
          version: NATIVE_HISTORY_CONTRACT_V3,
          path: 'stream.message.metadata.streaming_parent_id',
          reason: 'unexpected',
        })
      }
    } finally {
      await automation.stop()
      await capture.stop()
      audio.restore()
      Object.assign(globalThis, previous)
      await dom.happyDOM.close()
    }
  },
)
