#!/usr/bin/env node
/** Browser UI matrix, using only Chrome DevTools Protocol and Node 22 globals.
 * No provider credentials, browser profile or automation dependency required. */
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { checkAccessibilityUi } from './accessibility-ui-checks.mjs'
import { checkArchiveUi } from './archive-ui-checks.mjs'
import { checkAutomationUi } from './automation-ui-checks.mjs'
import { checkCorrectionUi } from './correction-ui-checks.mjs'
import { checkExplorer } from './explorer-checks.mjs'
import { checkExportScopeUi } from './export-scope-ui-checks.mjs'
import { checkHistoryUi } from './history-ui-checks.mjs'
import { checkReaderScrollUi } from './reader-scroll-ui-checks.mjs'
import { inspectUi } from './ui-inspect.mjs'
import { checkVkReaderUi } from './vk-reader-ui-checks.mjs'
import { checkWsUi } from './ws-ui-checks.mjs'

const mode = process.argv.includes('--full')
  ? 'full'
  : process.argv.includes('--smoke')
    ? 'smoke'
    : 'extended'
const focusedMode = [
  'accessibility-ui',
  'targeted-ui',
  'automation-ui',
  'archive-ui',
  'ws-ui',
  'inspect',
  'explorer',
  'correction-ui',
  'history-ui',
  'vk-reader-ui',
  'reader-scroll-ui',
  'export-scope-ui',
].find((name) => process.argv.includes(`--${name}`))
const reportMode = focusedMode ?? mode
const baseUrl = process.env.UI_LAB_URL || 'http://127.0.0.1:5173'
const deadlineMs = Number(
  process.env.UI_LAB_MATRIX_TIMEOUT_MS || (mode === 'full' ? 1_200_000 : 480_000),
)
const output = resolve(
  process.env.UI_LAB_REPORT_DIR || fileURLToPath(new URL('../.local/', import.meta.url)),
)
const labOrigin = new URL(baseUrl)
if (
  !['http:', 'https:'].includes(labOrigin.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(labOrigin.hostname) ||
  labOrigin.username ||
  labOrigin.password
) {
  throw Error('Browser UI checks require a loopback synthetic Lab URL')
}
const start = Date.now()
const candidates =
  process.platform === 'win32'
    ? [
        process.env.CHROME_BIN,
        ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
          .filter(Boolean)
          .flatMap((directory) => [
            join(directory, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            join(directory, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          ]),
      ]
    : [
        process.env.CHROME_BIN,
        'google-chrome',
        'google-chrome-stable',
        'chromium',
        'chromium-browser',
      ].filter(Boolean)
let chrome
for (const candidate of candidates.filter(Boolean)) {
  if (process.platform === 'win32') {
    // Discovery must never launch the user's ordinary browser profile.
    try {
      await access(candidate)
      chrome = candidate
      break
    } catch {
      /* next installation */
    }
  } else if (spawnSync(candidate, ['--version'], { stdio: 'ignore', timeout: 5000 }).status === 0) {
    chrome = candidate
    break
  }
}
if (!chrome) {
  await mkdir(output, { recursive: true })
  const reason = 'NO_CHROME: Chrome/Chromium executable unavailable or cannot load system libraries'
  await writeFile(
    join(output, `matrix-${reportMode}-blocked.json`),
    JSON.stringify({ schemaVersion: 1, status: 'blocked', mode: reportMode, reason }, null, 2),
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
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--disable-features=Translate,MediaRouter',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1500,1100',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
)
let browserClosed = false
const browserClosedPromise = new Promise((resolveExit) => {
  proc.once('close', () => {
    browserClosed = true
    resolveExit(true)
  })
})
let lastErr = ''
proc.stderr.on('data', (chunk) => {
  lastErr = (lastErr + chunk.toString()).slice(-3000)
})
let socket
let sequence = 0
const pending = new Map()
const runtimeErrors = []
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
    if (!payload.id) {
      if (payload.method === 'Runtime.exceptionThrown')
        runtimeErrors.push(payload.params.exceptionDetails)
      if (payload.method === 'Network.responseReceived' && payload.params.response.status >= 400)
        runtimeErrors.push({ status: payload.params.response.status, url: payload.params.response.url })
      if (payload.method === 'Log.entryAdded' && payload.params.entry.level === 'error')
        runtimeErrors.push(payload.params.entry)
      return
    }
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
  await command('Network.enable')
  await command('Log.enable')
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1500,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  })
  if (process.argv.includes('--export-scope-ui')) {
    await checkExportScopeUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--reader-scroll-ui')) {
    await checkReaderScrollUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--vk-reader-ui')) {
    await checkVkReaderUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--accessibility-ui')) {
    await checkAccessibilityUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--history-ui')) {
    await checkHistoryUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--correction-ui')) {
    await checkCorrectionUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--targeted-ui')) {
    await checkAutomationUi({ command, evaluate, baseUrl, output })
    await checkArchiveUi({ command, evaluate, baseUrl, output })
    await checkExplorer({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--automation-ui')) {
    await checkAutomationUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--archive-ui')) {
    await checkArchiveUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--ws-ui')) {
    await checkWsUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--inspect')) {
    await inspectUi({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else if (process.argv.includes('--explorer')) {
    await checkExplorer({ command, evaluate, baseUrl, output })
    exitCode = 0
  } else {
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
      const png = await command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
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
      const previewUrl = `${baseUrl}/preview.html?${query}`
      await command('Page.navigate', { url: previewUrl })
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
      let previousRect
      let stableSamples = 0
      const readyDeadline = Date.now() + 15000
      while (Date.now() < readyDeadline) {
        const sample = await evaluate(
          `(() => {
            if(location.href!==${JSON.stringify(previewUrl)}||document.readyState!=='complete')return null;
            const r=[...document.querySelectorAll('*')].find(el=>el.shadowRoot?.querySelector('.booster-launcher,.booster-modal-surface,.booster-quick-menu'))?.shadowRoot;
            const surface=r?.querySelector('.booster-modal-surface,.booster-quick-menu');
            const b=surface?.getBoundingClientRect();
            return {report:window.__uiLabPreviewReport??null,rect:b?[b.x,b.y,b.width,b.height]:[],settled:!surface||(getComputedStyle(surface).opacity==='1'&&!surface.getAnimations().some(a=>a.playState==='running'||a.pending))};
          })()`,
        )
        measured = sample?.report
        const sameRect =
          previousRect &&
          sample?.rect.length === previousRect.length &&
          sample.rect.every((value, i) => Math.abs(value - previousRect[i]) < 0.5)
        stableSamples =
          previewMatches(measured) && !measured.warnings?.length && sample?.settled && sameRect
            ? stableSamples + 1
            : 0
        previousRect = sample?.rect
        if (stableSamples >= 2) break
        await delay(100)
      }
      if (stableSamples < 2)
        throw Error(
          `Preview did not settle at the requested viewport: ${name}; ${JSON.stringify(measured)}`,
        )
      const pngSize = await screenshot(name, size)
      screenshots.push({ file: name, scenario: fields, requestedSize: size, pngSize, measured })
      await writeFile(join(output, `screenshots-${mode}.json`), JSON.stringify(screenshots, null, 2))
    }
    // Keep matrix results even if a replay record is malformed; never promote it to PASS.
    let invalidEvidence = false
    if (report.failed) console.error('Browser matrix failures:', JSON.stringify(report.failures))
    for (const [i, row] of (Array.isArray(report.failures) ? report.failures : [])
      .slice(0, 6)
      .entries()) {
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
  }
  const unexpected = runtimeErrors.filter(
    (error) =>
      !(error.status === 404 && String(error.url).endsWith('/favicon.ico')) &&
      !String(error.url).endsWith('/favicon.ico'),
  )
  if (exitCode === 0 && unexpected.length)
    throw Error(`Browser runtime or resource errors: ${JSON.stringify(unexpected.slice(-5))}`)
  if (focusedMode && exitCode === 0)
    await writeFile(
      join(output, `ui-${focusedMode}.json`),
      JSON.stringify(
        {
          schemaVersion: 1,
          status: 'pass',
          mode: focusedMode,
          scope: 'disposable-chromium-synthetic-only',
          baseUrl,
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    )
} catch (error) {
  exitCode = 1
  console.error('MATRIX_BROWSER_FAILURE:', String(error))
  if (runtimeErrors.length) console.error('Browser exceptions:', JSON.stringify(runtimeErrors.slice(-5)))
  if (lastErr) console.error('Chrome stderr tail:', lastErr.slice(-1500))
  await writeFile(
    join(output, `matrix-${reportMode}-blocked.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        status: 'blocked',
        mode: reportMode,
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
      await writeFile(join(output, `matrix-${reportMode}-blocked.png`), Buffer.from(png.data, 'base64'))
    } catch {
      /* Browser process already terminated. */
    }
  }
} finally {
  for (const task of pending.values()) task.reject(Error('Browser session closed'))
  try {
    socket?.close()
  } catch {}
  // Only the Chromium child created above belongs to this run. Wait for its
  // process handles to close before removing its disposable profile on Windows.
  if (!browserClosed) {
    proc.kill('SIGTERM')
    await Promise.race([browserClosedPromise, delay(1000)])
  }
  if (!browserClosed) {
    proc.kill('SIGKILL')
    await Promise.race([browserClosedPromise, delay(5000)])
  }
  const cleanupPath = resolve(profile)
  if (
    dirname(cleanupPath) !== resolve(tmpdir()) ||
    !basename(cleanupPath).startsWith('koba-ui-matrix-')
  ) {
    console.error('Refusing cleanup outside the isolated matrix profile')
    exitCode = 1
  } else if (!browserClosed) {
    console.error('Isolated Chromium did not exit; retaining its temporary profile:', cleanupPath)
    exitCode = 1
  } else {
    try {
      await rm(cleanupPath, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
    } catch (error) {
      console.error('Could not remove isolated browser profile:', String(error), cleanupPath)
      exitCode = 1
    }
  }
}
process.exit(exitCode)
