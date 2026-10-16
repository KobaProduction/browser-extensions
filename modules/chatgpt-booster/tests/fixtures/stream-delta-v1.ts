/** Generated source-shaped protocol data only. No account, credentials or
 * captured user records. Shapes follow native public sY DeltaPayloadDecoder. */
export function syntheticDeltaV1Stream(conversationId = 'network-chat') {
  const message = (
    id: string,
    role: string,
    content: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    conversation_id: conversationId,
    message: {
      id,
      author: { role, metadata: {} },
      recipient: 'all',
      channel: null,
      content,
      metadata: { parent_id: 'synthetic-parent' },
      status: 'finished_successfully',
      end_turn: null,
      ...extra,
    },
    error: null,
    error_code: null,
  })
  return [
    { event: 'delta_encoding', data: 'v1' },
    {
      event: null,
      data: {
        type: 'message_marker',
        conversation_id: conversationId,
        message_id: 'synthetic-user',
        marker: 'user_visible_token',
        event: 'first',
      },
    },
    {
      event: null,
      data: {
        type: 'input_message',
        conversation_id: conversationId,
        input_message: {
          id: 'synthetic-user',
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['Synthetic request'] },
          metadata: { parent_id: 'synthetic-parent' },
        },
      },
    },
    {
      event: 'delta',
      data: {
        c: 0,
        o: 'add',
        p: '',
        v: message('synthetic-system', 'system', { content_type: 'text', parts: [''] }),
      },
    },
    {
      event: null,
      data: {
        type: 'message_marker',
        conversation_id: conversationId,
        message_id: 'synthetic-recap',
        marker: 'cot_token',
        event: 'first',
      },
    },
    {
      event: 'delta',
      data: {
        c: 1,
        v: message(
          'synthetic-recap',
          'assistant',
          { content_type: 'reasoning_recap', content: 'Synthetic recap' },
          { end_turn: false },
        ),
      },
    },
    {
      event: null,
      data: {
        type: 'message_marker',
        conversation_id: conversationId,
        message_id: 'synthetic-final',
        marker: 'user_visible_token',
        event: 'first',
      },
    },
    {
      event: null,
      data: {
        type: 'message_marker',
        conversation_id: conversationId,
        message_id: 'synthetic-final',
        marker: 'final_channel_token',
        event: 'first',
      },
    },
    {
      event: 'delta',
      data: {
        c: 2,
        v: message(
          'synthetic-final',
          'assistant',
          { content_type: 'text', parts: ['SYNTHETIC'] },
          {
            channel: 'final',
            status: 'in_progress',
            metadata: {
              parent_id: 'synthetic-recap',
              conversation_followup_suggestions_eligible: false,
              model_dil_v2: {
                constants: { '0': 'SYNTHETIC' },
                fallbackMarkdown: 'SYNTHETIC',
                unknown_native_field: { retained: true },
              },
            },
          },
        ),
      },
    },
    {
      event: 'delta',
      data: {
        o: 'patch',
        v: [
          { o: 'append', p: '/message/content/parts/0', v: '_READY' },
          { o: 'append', p: '/message/metadata/model_dil_v2/constants', v: { '0': 'SYNTHETIC_READY' } },
          { o: 'append', p: '/message/metadata/model_dil_v2/fallbackMarkdown', v: '_READY' },
        ],
      },
    },
    {
      event: 'delta',
      data: {
        v: [
          { o: 'replace', p: '/message/status', v: 'finished_successfully' },
          { o: 'replace', p: '/message/end_turn', v: true },
          {
            o: 'append',
            p: '/message/metadata',
            v: { can_save: true, finish_details: { type: 'stop' } },
          },
        ],
      },
    },
    {
      event: null,
      data: {
        type: 'message_marker',
        conversation_id: conversationId,
        message_id: 'synthetic-final',
        marker: 'last_token',
        event: 'last',
      },
    },
    {
      event: 'delta',
      data: { o: 'replace', p: '/message/metadata/conversation_followup_suggestions_eligible', v: true },
    },
    {
      event: null,
      data: {
        type: 'server_ste_metadata',
        conversation_id: conversationId,
        metadata: { request_id: 'synthetic-request', model_slug: 'synthetic-model' },
      },
    },
    { event: null, data: { type: 'message_stream_complete', conversation_id: conversationId } },
    {
      event: null,
      data: {
        type: 'conversation_detail_metadata',
        conversation_id: conversationId,
        default_model_slug: 'synthetic-model',
      },
    },
    { event: null, data: '[DONE]' },
  ]
}
