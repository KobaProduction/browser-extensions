/** Provider-neutral lifecycle for collection of one verified conversation.
 * Neither this contract nor its controller knows ChatGPT/VK payloads or storage. */
export interface ChatCollectionSnapshot {
  readonly phase: 'idle' | 'running' | 'completed' | 'cancelled' | 'error'
  readonly processed: number
  readonly total: number | null
  readonly saved: number | null
}
export interface ChatCollectionPort {
  /** by-event: start returns before provider source paging finishes. */
  readonly completion?: 'on-return' | 'by-event'
  /** Provider checks account, conversation, privileges and capture policy. */
  start(): Promise<void>
  stop(): void
  snapshot(): ChatCollectionSnapshot
  subscribe(listener: (snapshot: ChatCollectionSnapshot) => void): () => void
}
export interface ChatCollectionController {
  start(): Promise<void>
  stop(): void
  snapshot(): ChatCollectionSnapshot
  subscribe(listener: (state: ChatCollectionSnapshot) => void): () => void
  dispose(): void
}
/** Single-flight orchestration and status fan-out; cancellation is owned by the provider. */
export declare function createChatCollectionController(
  port: ChatCollectionPort,
): ChatCollectionController
