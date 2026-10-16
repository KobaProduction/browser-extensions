import type { BackupFileOutput } from '@kobaproduction/browser-core'

interface BackupWritableFile {
  write(bytes: Uint8Array<ArrayBuffer>): Promise<void>
  close(): Promise<void>
  abort(reason?: unknown): Promise<void>
}
interface BackupFileHandle {
  createWritable(options: { keepExistingData: false }): Promise<BackupWritableFile>
}
type BackupPickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<BackupFileHandle>
}

/** Call directly from a user gesture, before reading/preparing the backup.
 * The wrapper's stream close only marks preparation complete: native file close
 * is deferred until the shared exporter has validated the sealed snapshot. */
export async function chooseBrowserBackupOutput(
  filename: string,
): Promise<BackupFileOutput | undefined> {
  const host = window as BackupPickerWindow
  if (typeof host.showSaveFilePicker !== 'function') return undefined
  const handle = await host.showSaveFilePicker({
    suggestedName: filename,
    types: [
      { description: 'Резервная копия Browser Tools', accept: { 'application/gzip': ['.tar.gz'] } },
    ],
  })
  const file = await handle.createWritable({ keepExistingData: false })
  let phase: 'open' | 'prepared' | 'committing' | 'committed' | 'aborted' = 'open'
  const abort = async (reason?: unknown) => {
    if (phase === 'committed' || phase === 'aborted') return
    phase = 'aborted'
    await file.abort(reason)
  }
  const writable = new WritableStream<Uint8Array<ArrayBuffer>>({
    async write(bytes) {
      if (phase !== 'open') throw Error('Backup output is not writable')
      await file.write(bytes)
    },
    close() {
      if (phase !== 'open') throw Error('Backup output cannot be prepared')
      phase = 'prepared'
    },
    abort,
  })
  return {
    writable,
    abort,
    async commit() {
      if (phase === 'open') {
        const writer = writable.getWriter()
        try {
          await writer.close()
        } finally {
          writer.releaseLock()
        }
      }
      if (phase !== 'prepared') throw Error('Backup output is not prepared')
      phase = 'committing'
      try {
        await file.close()
        phase = 'committed'
      } catch (error) {
        await abort(error).catch(() => undefined)
        throw error
      }
    },
  }
}
