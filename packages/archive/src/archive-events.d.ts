/** Commit invalidation only. No records, conversation IDs or account data cross tabs. */
export interface ArchiveChangeFeed {
  revision(): number
  publish(): void
  subscribe(listener: () => void): () => void
  close(): void
}
export declare function createArchiveChangeFeed(namespace: string): ArchiveChangeFeed
