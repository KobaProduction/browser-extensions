import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/** Check the distributed provider stylesheet graph, including late adopted sheets. */
function providerStyles(entry: URL, visited = new Set<string>()): string {
  if (visited.has(entry.href)) return ''
  visited.add(entry.href)
  const source = readFileSync(entry, 'utf8')
  const children = [...source.matchAll(/@import\s+["'](\.\.?\/[^"']+)["']/g)]
    .map((match) => providerStyles(new URL(match[1] as string, entry), visited))
    .join('\n')
  return `${source}\n${children}`.replace(/\/\*[\s\S]*?\*\//g, '')
}
test('active ChatGPT styles cannot take ownership of shared launcher and quick-menu geometry', () => {
  const source = providerStyles(
    new URL('../../../modules/chatgpt-booster/packages/ui/src/styles.css', import.meta.url),
  )
  expect(source).not.toMatch(
    /\.booster-(?:launcher(?:-[\w-]+)?|edge-toolkit|edge-shell|quick-(?:menu|header|actions|context))\b/,
  )
})
