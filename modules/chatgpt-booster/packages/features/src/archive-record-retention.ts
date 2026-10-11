import { archiveRecordKind, asRecord } from '@chatgpt-booster/chatgpt'
import type { CaptureRule } from '@chatgpt-booster/core'

/** Provider source-category allowlist shared by the current Dexie writer and
 * the frozen native-v4 historical implementation. */
export function retainRawSource(raw: Readonly<Record<string, unknown>>, rule: CaptureRule): boolean {
  const author = asRecord(raw.author)
  const content = asRecord(raw.content)
  const metadata = asRecord(raw.metadata)
  const kind = archiveRecordKind({
    raw,
    role: author?.role ?? null,
    recipient: raw.recipient ?? null,
    channel: raw.channel ?? null,
    contentType: content?.content_type ?? null,
    messageType: metadata?.message_type ?? null,
  } as Parameters<typeof archiveRecordKind>[0])
  if (kind === 'user' || kind === 'answer') return true
  if (kind === 'reasoning') return rule.reasoning
  if (kind === 'tool_call' || kind === 'tool_result') return rule.tools
  return rule.internal
}
