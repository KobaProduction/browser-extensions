/** Portable, collision-free structured-clone encoding for IndexedDB rows that
 * are NOT representable by JSON. Ordinary JSON rows stay in their native form;
 * this tagged representation is used only when the lossless fast path fails.
 * References/cycles and arbitrary class instances are refused rather than
 * silently lost. No application source/owner information is interpreted. */
export type ArchiveCloneNode = unknown
/** Logical source depth; tagged JSON adds up to three edges per source edge. */
export declare const ARCHIVE_CLONE_MAX_DEPTH = 150
/** Object/Array/Map wrappers add three levels; a tagged scalar adds one. */
export declare const ARCHIVE_CLONE_JSON_MAX_DEPTH: number
export declare function encodeArchiveClone(value: unknown): Promise<ArchiveCloneNode>
export declare function decodeArchiveClone(value: ArchiveCloneNode): unknown
