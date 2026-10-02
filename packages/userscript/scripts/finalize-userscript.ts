import { readFile, writeFile } from 'node:fs/promises'

export const userscriptOutput = new URL('../dist/chatgpt-booster.user.js', import.meta.url)

const metadata = [
  '// ==UserScript==',
  '// @name         ChatGPT Booster',
  '// @namespace    https://github.com/KobaProduction/chatgpt-booster',
  '// @version      0.2.0',
  '// @description  Open-source UI and productivity toolkit for ChatGPT.',
  '// @author       KobaProduction',
  '// @match        https://chatgpt.com/*',
  '// @run-at       document-idle',
  '// @grant        GM_registerMenuCommand',
  '// @updateURL    https://github.com/KobaProduction/chatgpt-booster/releases/latest/download/chatgpt-booster.user.js',
  '// @downloadURL  https://github.com/KobaProduction/chatgpt-booster/releases/latest/download/chatgpt-booster.user.js',
  '// ==/UserScript==',
].join('\n')

export async function finalizeUserscript(outputPath = userscriptOutput): Promise<void> {
  const bundled = await readFile(outputPath, 'utf8')
  const payload = bundled.startsWith('// ==UserScript==') ? bundled : `${metadata}\n\n${bundled}`

  await writeFile(outputPath, payload, 'utf8')

  const finalized = await readFile(outputPath, 'utf8')
  if (!finalized.startsWith('// ==UserScript==')) {
    throw new Error('Userscript metadata header is missing after finalization')
  }
  if (!finalized.includes('// @match        https://chatgpt.com/*')) {
    throw new Error('Userscript metadata does not target chatgpt.com')
  }
  if (/\bprocess\.env\b/.test(finalized)) {
    throw new Error('Userscript bundle contains unresolved Node process.env references')
  }
}

if (import.meta.main) {
  await finalizeUserscript()
}
