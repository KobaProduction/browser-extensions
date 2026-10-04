import { readFile, writeFile } from 'node:fs/promises'
import packageJson from '../package.json' with { type: 'json' }

type UserscriptVariant = 'prod' | 'dev'

const baseVersion = packageJson.version
const buildSha = (process.env.CHATGPT_BOOSTER_BUILD_SHA ?? '').trim()
const buildNumber = (process.env.CHATGPT_BOOSTER_BUILD_NUMBER ?? '').trim()
const rolling = process.env.CHATGPT_BOOSTER_ROLLING === '1'
const shortSha = buildSha ? buildSha.slice(0, 8) : ''
const buildLabel = shortSha ? `${baseVersion}-g${shortSha}` : baseVersion

function outputFor(variant: UserscriptVariant): URL {
  return new URL(
    variant === 'dev' ? '../dist/chatgpt-booster.dev.user.js' : '../dist/chatgpt-booster.user.js',
    import.meta.url,
  )
}

function metadataVersion(variant: UserscriptVariant) {
  if (variant === 'dev' && rolling && buildNumber) return `${baseVersion}.${buildNumber}`
  return baseVersion
}

function assetBase(variant: UserscriptVariant) {
  if (variant === 'dev' && rolling)
    return 'https://github.com/KobaProduction/chatgpt-booster/releases/download/dev-latest'
  return 'https://github.com/KobaProduction/chatgpt-booster/releases/latest/download'
}

function metadataFor(variant: UserscriptVariant): string {
  const isDev = variant === 'dev'
  const file = isDev ? 'chatgpt-booster.dev.user.js' : 'chatgpt-booster.user.js'
  const base = assetBase(variant)
  return [
    '// ==UserScript==',
    `// @name         ChatGPT Booster${isDev ? ' Dev' : ''}`,
    '// @namespace    https://github.com/KobaProduction/chatgpt-booster',
    `// @version      ${metadataVersion(variant)}`,
    `// @description  Open-source UI and productivity toolkit for ChatGPT.${isDev ? ` Debug build ${buildLabel}.` : ''}`,
    `// @booster-build ${buildLabel}`,
    '// @author       KobaProduction',
    '// @match        https://chatgpt.com/*',
    '// @run-at       document-start',
    '// @grant        GM_registerMenuCommand',
    '// @grant        GM_getValue',
    '// @grant        GM_setValue',
    '// @grant        GM_xmlhttpRequest',
    '// @grant        unsafeWindow',
    '// @connect      *',
    `// @updateURL    ${base}/${file}`,
    `// @downloadURL  ${base}/${file}`,
    '// ==/UserScript==',
  ].join('\n')
}

export async function finalizeUserscript(
  options: { variant?: UserscriptVariant } = {},
): Promise<void> {
  const variant = options.variant ?? 'prod'
  const outputPath = outputFor(variant)
  const bundled = await readFile(outputPath, 'utf8')
  const metadata = metadataFor(variant)
  let payload = bundled.startsWith('// ==UserScript==') ? bundled : `${metadata}\n\n${bundled}`
  if (variant === 'dev') {
    const mapBase = assetBase(variant)
    payload = payload.replace(
      /\/\/# sourceMappingURL=.*$/m,
      `//# sourceMappingURL=${mapBase}/chatgpt-booster.dev.user.js.map`,
    )
  }

  await writeFile(outputPath, payload, 'utf8')

  const finalized = await readFile(outputPath, 'utf8')
  if (!finalized.startsWith('// ==UserScript=='))
    throw new Error('Userscript metadata header is missing')
  if (!finalized.includes('// @match        https://chatgpt.com/*')) {
    throw new Error('Userscript metadata does not target chatgpt.com')
  }
  if (/\bprocess\.env\b/.test(finalized)) {
    throw new Error('Userscript bundle contains unresolved Node process.env references')
  }
}

if (import.meta.main) {
  await finalizeUserscript({
    variant: process.env.CHATGPT_BOOSTER_VARIANT === 'dev' ? 'dev' : 'prod',
  })
}
