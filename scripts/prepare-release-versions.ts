import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { scopeFor } from './catalog'
import { devChannelCandidates } from './channel-plan'
import { assignReleaseVersion, gitText, publishedReleaseVersions } from './release-versions'

if (import.meta.main) {
  const sha = process.env.GITHUB_SHA
  if (!sha || gitText('rev-parse', 'HEAD') !== sha)
    throw Error('Release must use the exact checked-out CI source')
  const ledger = publishedReleaseVersions()
  if (!ledger) throw Error('Cannot establish installed version baseline; refusing to guess')
  const candidates = process.argv.includes('--all-in-one')
    ? [{ id: 'all-in-one', version: '' }]
    : await devChannelCandidates(`${sha}^`, sha)
  for (const { id } of candidates) {
    if (id !== 'vk-booster' && id !== 'chatgpt-booster' && id !== 'all-in-one')
      throw Error('Unknown release product')
    const previous = ledger.products[id]
    const range = previous.sourceSha === sha ? sha : `${previous.sourceSha}..${sha}`
    const messages = gitText('log', '--format=%B%x00', range, '--', ...scopeFor(id))
    if (messages === null) throw Error('Cannot inspect release commit history')
    ledger.products[id] = assignReleaseVersion(previous, sha, messages.split('\0'))
  }
  const output = resolve('.release-versions.json')
  await writeFile(output, `${JSON.stringify(ledger, null, 2)}\n`)
  for (const { id } of candidates)
    console.log(`${id}|${ledger.products[id as keyof typeof ledger.products].version}`)
}
