const outputPath = new URL('../dist/chatgpt-booster.user.js', import.meta.url)

const metadata = [
  '// ==UserScript==',
  '// @name         ChatGPT Booster',
  '// @namespace    https://github.com/KobaProduction/chatgpt-booster',
  '// @version      0.1.0',
  '// @description  Open-source UI and productivity toolkit for ChatGPT.',
  '// @author       KobaProduction',
  '// @match        https://chatgpt.com/*',
  '// @grant        none',
  '// @updateURL    https://github.com/KobaProduction/chatgpt-booster/releases/latest/download/chatgpt-booster.user.js',
  '// @downloadURL  https://github.com/KobaProduction/chatgpt-booster/releases/latest/download/chatgpt-booster.user.js',
  '// ==/UserScript==',
].join('\n')

const file = Bun.file(outputPath)
if (!(await file.exists())) {
  throw new Error('Userscript build output not found: ' + outputPath.pathname)
}

const bundled = await file.text()
const payload = bundled.startsWith('// ==UserScript==') ? bundled : metadata + '\n\n' + bundled
await Bun.write(outputPath, payload)

const finalized = await Bun.file(outputPath).text()
if (!finalized.startsWith('// ==UserScript==')) {
  throw new Error('Userscript metadata header is missing after finalization')
}
if (!finalized.includes('// @match        https://chatgpt.com/*')) {
  throw new Error('Userscript metadata does not target chatgpt.com')
}
