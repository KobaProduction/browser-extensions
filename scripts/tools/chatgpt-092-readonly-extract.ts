import { exportLegacy092NativeV3 } from '../../modules/chatgpt-booster/packages/features/src/archive-legacy092-extract'

/**
 * Standalone browser helper. Bundle this into ONE script, then load it in the
 * original ChatGPT storage origin. Loading only registers a user-invoked tool.
 * It never starts a scan, network request or database write automatically.
 */
async function extract(): Promise<Readonly<Record<string, number>>> {
  if (location.origin !== 'https://chatgpt.com' && location.protocol !== 'chrome-extension:')
    throw Error('Open the original ChatGPT browser storage context first')
  const result = await exportLegacy092NativeV3()
  const url = URL.createObjectURL(result.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'chatgpt-booster-0.8.92-v3-original-readonly.jsonl.gz'
  try {
    anchor.click()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  return result.counts
}

const target = globalThis as typeof globalThis & {
  KobaLegacy092Backup?: { readonly exportReadOnly: typeof extract }
}
if (target.KobaLegacy092Backup) throw Error('Existing legacy backup tool must not be overwritten')
target.KobaLegacy092Backup = Object.freeze({ exportReadOnly: extract })
