import { readFile, writeFile } from 'node:fs/promises'

type UserscriptVariant = 'prod' | 'dev'

const version = '0.4.3'

function outputFor(variant: UserscriptVariant): URL {
  return new URL(
    variant === 'dev' ? '../dist/chatgpt-booster.dev.user.js' : '../dist/chatgpt-booster.user.js',
    import.meta.url,
  )
}

function metadataFor(variant: UserscriptVariant): string {
  const isDev = variant === 'dev'
  const file = isDev ? 'chatgpt-booster.dev.user.js' : 'chatgpt-booster.user.js'
  return [
    '// ==UserScript==',
    `// @name         ChatGPT Booster${isDev ? ' Dev' : ''}`,
    '// @namespace    https://github.com/KobaProduction/chatgpt-booster',
    `// @version      ${version}`,
    `// @description  Open-source UI and productivity toolkit for ChatGPT.${isDev ? ' Debug build.' : ''}`,
    '// @author       KobaProduction',
    '// @match        https://chatgpt.com/*',
    '// @run-at       document-start',
    '// @grant        GM_registerMenuCommand',
    '// @grant        GM_getValue',
    '// @grant        GM_setValue',
    '// @grant        GM_xmlhttpRequest',
    '// @grant        unsafeWindow',
    '// @connect      *',
    `// @updateURL    https://github.com/KobaProduction/chatgpt-booster/releases/latest/download/${file}`,
    `// @downloadURL  https://github.com/KobaProduction/chatgpt-booster/releases/latest/download/${file}`,
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
  const payload = bundled.startsWith('// ==UserScript==') ? bundled : `${metadata}\n\n${bundled}`

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
