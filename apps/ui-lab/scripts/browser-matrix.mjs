#!/usr/bin/env node
/** Browser UI matrix, using only Chrome DevTools Protocol and Node 22 globals.
 * No provider credentials, browser profile or automation dependency required. */
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const mode = process.argv.includes('--full')
  ? 'full'
  : process.argv.includes('--smoke')
    ? 'smoke'
    : 'extended'
const baseUrl = process.env.UI_LAB_URL || 'http://127.0.0.1:5173'
const deadlineMs = Number(
  process.env.UI_LAB_MATRIX_TIMEOUT_MS || (mode === 'full' ? 1_200_000 : 480_000),
)
const output = resolve(process.env.UI_LAB_REPORT_DIR || 'apps/ui-lab/.local')
const start = Date.now()
const candidates = [
  process.env.CHROME_BIN,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
].filter(Boolean)
const chrome = candidates.find(
  (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 }).status === 0,
)
if (!chrome) {
  await mkdir(output, { recursive: true })
  const reason = 'NO_CHROME: Chrome/Chromium executable unavailable or cannot load system libraries'
  await writeFile(
    join(output, `matrix-${mode}-blocked.json`),
    JSON.stringify({ schemaVersion: 1, status: 'blocked', mode, reason }, null, 2),
  )
  console.error(reason)
  process.exit(2)
}
const profile = await mkdtemp(join(tmpdir(), 'koba-ui-matrix-'))
await mkdir(output, { recursive: true })
const proc = spawn(
  chrome,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-features=Translate,MediaRouter',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1500,1100',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
let lastErr = ''
proc.stderr.on('data', (chunk) => {
  lastErr = (lastErr + chunk.toString()).slice(-3000)
})
let socket
let sequence = 0
const pending = new Map()
let exitCode = 1
let protocol = null
try {
  let port
  while (!port && Date.now() - start < 18000) {
    if (proc.exitCode !== null) throw Error(`Chromium exited: ${lastErr}`)
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0])
    } catch {
      await delay(100)
    }
  }
  if (!port) throw Error(`Chrome debugging port was not created: ${lastErr}`)
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(
    (r) => r.json(),
  )
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data.toString())
    if (!payload.id) return
    const task = pending.get(payload.id)
    if (!task) return
    pending.delete(payload.id)
    if (payload.error) task.reject(Error(JSON.stringify(payload.error)))
    else task.resolve(payload.result)
  })
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  protocol = command
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await command('Page.navigate', { url: `${baseUrl}/?autorun=${mode}` })
  const deadline = Date.now() + deadlineMs
  let last = -1
  let lastProgressAt = Date.now()
  let report
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw Error(`Chromium exited while testing: ${lastErr}`)
    report = await evaluate('window.__uiLabMatrixReport ?? null')
    if (report?.finished) break
    if (Date.now() - start > 8000) {
      const progress = await evaluate(
        'document.querySelector("[data-testid=matrix-progress]")?.textContent ?? "not mounted"',
      )
      const count = Number((progress || '').trim().match(/^([0-9]+)/)?.[1] ?? -1)
      if (count !== last && count >= 0) {
        lastProgressAt = Date.now()
        console.log(`Progress ${progress.trim().replace(/\s+/g, ' ')}`)
        last = count
      }
    }
    if (Date.now() - lastProgressAt > 50000)
      throw Error(`No browser matrix progress for 50s (last completed ${last})`)
    await delay(800)
  }
  if (!report?.finished)
    throw Error(`Matrix ${mode} timed out after ${deadlineMs}ms (last case ${last})`)
  const pathname = join(output, `matrix-${mode}.json`)
  await writeFile(
    pathname,
    JSON.stringify({ ...report, source: 'chromium-cdp', browser: chrome }, null, 2),
  )
  console.log(
    `MATRIX ${mode}: ${report.executed}/${report.total} checked, ${report.passed} passed, ${report.failed} failed; report: ${pathname}`,
  )
  const screenshot = async (name, expectedSize) => {
    const png = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const bytes = Buffer.from(png.data, 'base64')
    if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG')
      throw Error(`Screenshot is not a PNG: ${name}`)
    const size = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
    if (expectedSize && size.some((value, i) => value !== expectedSize[i]))
      throw Error(`Screenshot viewport mismatch: ${name} (${size} != ${expectedSize})`)
    await writeFile(join(output, name), bytes)
    return size
  }
  await screenshot(`matrix-${mode}-final.png`, [1500, 1050])
  const screenshots = []
  const capturePreview = async (name, fields) => {
    const size = report.viewports?.[fields.viewport]
    if (!Array.isArray(size) || size.length !== 2 || size.some((v) => !Number.isInteger(v) || v <= 0))
      throw Error(`Unknown or invalid scenario viewport: ${fields.viewport}`)
    const [width, height] = size
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    const query = new URLSearchParams({
      product: fields.product,
      scene: fields.scene,
      view: fields.view,
      method: fields.method,
      side: fields.side,
    })
    await command('Page.navigate', { url: `${baseUrl}/preview.html?${query}` })
    // Reject a previous navigation or a panel whose provider is still hydrating.
    const previewMatches = (measured) => {
      const needsSettingsGrid =
        fields.view === 'settings' &&
        fields.scene !== 'disabled' &&
        ['chatgpt', 'all-in-one'].includes(fields.product)
      return (
        measured?.shell &&
        measured.product === fields.product &&
        measured.scene === fields.scene &&
        measured.view === fields.view &&
        measured.method === fields.method &&
        measured.side === fields.side &&
        measured.width === width &&
        measured.height === height &&
        (!needsSettingsGrid || measured.gridDisplay === 'grid') &&
        (fields.view === 'quick'
          ? measured.quick && !measured.modal
          : fields.view === 'closed'
            ? !measured.quick && !measured.modal
            : measured.modal)
      )
    }
    let measured
    const readyDeadline = Date.now() + 15000
    while (Date.now() < readyDeadline) {
      measured = await evaluate(
        'document.readyState === "complete" ? window.__uiLabPreviewReport ?? null : null',
      )
      if (previewMatches(measured)) break
      await delay(100)
    }
    if (!previewMatches(measured))
      throw Error(`Preview did not mount at the requested viewport: ${name}`)
    const pngSize = await screenshot(name, size)
    screenshots.push({ file: name, scenario: fields, requestedSize: size, pngSize, measured })
    await writeFile(join(output, `screenshots-${mode}.json`), JSON.stringify(screenshots, null, 2))
  }
  // Keep matrix results even if a replay record is malformed; never promote it to PASS.
  let invalidEvidence = false
  if (report.failed) console.error('Browser matrix failures:', JSON.stringify(report.failures))
  for (const [i, row] of (Array.isArray(report.failures) ? report.failures : []).slice(0, 6).entries()) {
    if (typeof row?.id !== 'string' || row.id.split(':').length !== 6) {
      console.error('MALFORMED_FAILURE_RECORD:', JSON.stringify(row))
      invalidEvidence = true
      continue
    }
    const parts = row.id.split(':')
    const keys = ['product', 'scene', 'view', 'viewport', 'method', 'side']
    const fields = Object.fromEntries(keys.map((key, i) => [key, parts[i]]))
    await capturePreview(`matrix-${mode}-failure-${i + 1}.png`, fields)
  }
  const samples = [
    ['chatgpt', 'saved', 'settings', 'tampermonkey', 'right', 'desktop'],
    ['chatgpt', 'saved', 'quick', 'chromium', 'left', 'mobile'],
    ['vk', 'saved', 'settings', 'tampermonkey', 'left', 'tablet'],
    ['vk', 'saved', 'quick', 'chromium', 'right', 'mobile'],
    ['all-in-one', 'saved', 'quick', 'tampermonkey', 'right', 'desktop'],
    ['all-in-one-vk', 'saved', 'archive', 'chromium', 'left', 'tablet'],
    ['chatgpt', 'saved', 'settings', 'tampermonkey', 'left', 'mobile'],
    ['all-in-one', 'saved', 'settings', 'tampermonkey', 'left', 'desktop'],
    ['all-in-one', 'saved', 'settings', 'chromium', 'right', 'tablet'],
    ['all-in-one', 'saved', 'settings', 'tampermonkey', 'left', 'mobile'],
  ]
  for (const [i, sample] of samples.entries()) {
    const [product, scene, view, method, side, viewport] = sample
    await capturePreview(`matrix-${mode}-sample-${i + 1}-${product}-${view}.png`, {
      product,
      scene,
      view,
      method,
      side,
      viewport,
    })
  }
  exitCode = report.failed === 0 && report.executed === report.total && !invalidEvidence ? 0 : 1
} catch (error) {
  console.error('MATRIX_BROWSER_FAILURE:', String(error))
  if (lastErr) console.error('Chrome stderr tail:', lastErr.slice(-1500))
  await writeFile(
    join(output, `matrix-${mode}-blocked.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        status: 'blocked',
        mode,
        reason: String(error),
        chromeStderrTail: lastErr.slice(-1500),
      },
      null,
      2,
    ),
  )
  if (protocol) {
    try {
      const png = await protocol('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      await writeFile(join(output, `matrix-${mode}-blocked.png`), Buffer.from(png.data, 'base64'))
    } catch {
      /* Browser process already terminated. */
    }
  }
} finally {
  for (const task of pending.values()) task.reject(Error('Browser session closed'))
  try {
    socket?.close()
  } catch {}
  proc.kill('SIGTERM')
  await delay(300)
  if (proc.exitCode === null) proc.kill('SIGKILL')
  await rm(profile, { recursive: true, force: true })
}
process.exit(exitCode)
