import { ARCHIVE_CLONE_JSON_MAX_DEPTH } from '@kobaproduction/browser-archive'

// Both the sync-row object and its canonical [sequence,store,key,value] tuple
// put the provider's complete encoded value one level below their root.
export const REMOTE_JSON_MAX_DEPTH = ARCHIVE_CLONE_JSON_MAX_DEPTH + 1
