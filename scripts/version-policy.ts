import { readFile } from 'node:fs/promises'
import { releaseProducts } from './release-versions'

/** Published versions belong to CI's Git ledger, never to source manifests. */
export async function validateVersionPolicy() {
  for (const id of releaseProducts) {
    const path = id === 'all-in-one' ? 'apps/all-in-one.json' : `modules/${id}/module.json`
    const source = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    if ('version' in source) throw Error(`Remove manual product version from ${path}; CI assigns it`)
  }
}
if (import.meta.main) {
  await validateVersionPolicy()
  console.log('CI-owned product version policy validated')
}
