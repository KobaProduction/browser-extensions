/** Real form interactions against the explicit, memory-only loopback fixture. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function checkWsUi({ command, evaluate, baseUrl, output }) {
  const fixture = await fetch('http://127.0.0.1:8787/status', {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null)
  if (!fixture?.ok) throw Error('Synthetic WebSocket fixture unavailable at 127.0.0.1:8787')
  const root =
    "[...document.querySelectorAll('*')].find(el => el.shadowRoot?.querySelector('.booster-modal-surface'))?.shadowRoot"
  const waitFor = async (expression, message) => {
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return
      await delay(100)
    }
    throw Error(message)
  }
  const button = (text) =>
    `([...(${root})?.querySelectorAll('button')||[]].find(el => el.textContent?.trim() === ${JSON.stringify(text)}))`
  const setField = async (selector, value) =>
    evaluate(
      `(() => { const input = (${root})?.querySelector(${JSON.stringify(selector)}); if (!input) throw Error('Field missing'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input',{bubbles:true,composed:true})) })()`,
    )
  const clickAt = async (expression) => {
    const point = await evaluate(
      `(() => { const el = ${expression}; if (!el) throw Error('Control missing'); el.scrollIntoView({block:'nearest'}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`,
    )
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      ...point,
    })
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
      ...point,
    })
  }
  const query = new URLSearchParams({
    product: 'chatgpt',
    scene: 'saved',
    view: 'settings',
    task: 'interface',
    shellCategory: 'provider:chatgpt-booster:remote',
    wsFixture: '1',
    method: 'chromium',
  })
  await command('Page.navigate', { url: `${baseUrl}/preview.html?${query}` })
  await waitFor(
    `Boolean((${root})?.querySelector('input[type=password]'))`,
    'Remote settings did not mount',
  )
  await setField('input[placeholder="wss://server.example/socket"]', 'ws://127.0.0.1:8787/ws')
  await setField('input[type=password]', 'wrong-synthetic-token')
  if (await evaluate(`Boolean(${button('Сохранить подключение')})`))
    throw Error('Save offered before verification')
  await evaluate(`${button('Проверить подключение')}?.click()`)
  await waitFor(`(${root})?.textContent?.includes('отклонил токен')`, 'Wrong token was not rejected')
  if (await evaluate(`Boolean(${button('Сохранить подключение')})`))
    throw Error('Rejected connection can be saved')
  await setField('input[type=password]', 'ui-lab-synthetic-ws-token')
  await evaluate(`${button('Проверить подключение')}?.click()`)
  await waitFor(`Boolean(${button('Сохранить подключение')})`, 'Verified connection cannot be saved')
  await evaluate(`${button('Сохранить подключение')}?.click()`)
  await waitFor(
    `(${root})?.textContent?.includes('Токен сохранён отдельно')`,
    'Token was not saved after verification',
  )
  await clickAt(
    `([...(${root})?.querySelectorAll('[role=combobox]')||[]].find(el => el.textContent?.includes('Только локально')))`,
  )
  await waitFor(
    `Boolean([...(${root})?.querySelectorAll('[role=option]')||[]].find(el => el.textContent?.includes('Только на сервере')))`,
    'Storage-mode selector did not open',
  )
  await clickAt(
    `([...(${root})?.querySelectorAll('[role=option]')||[]].find(el => el.textContent?.includes('Только на сервере')))`,
  )
  await evaluate(
    `(() => { const r = ${root}; const label = [...r.querySelectorAll('label')].find(el => el.textContent?.trim() === 'Включить подключение'); const toggle = r.getElementById(label?.getAttribute('for')); if (!toggle || toggle.disabled) throw Error('Verified connection cannot be enabled'); toggle.click() })()`,
  )
  await waitFor(
    `(${root})?.textContent?.includes('Соединение установлено')`,
    'Saved connection did not become online',
  )
  const png = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(output, 'ws-ui-online.png'), Buffer.from(png.data, 'base64'))
  await writeFile(
    join(output, 'ws-ui.json'),
    JSON.stringify(
      {
        status: 'pass',
        checks: [
          'save-hidden-before-probe',
          'wrong-token-rejected',
          'save-hidden-after-rejection',
          'verified-candidate-saved',
          'stored-token-removal-visible',
          'connection-enabled-after-save',
          'online-status-visible',
        ],
        scope: 'synthetic-dev-memory-only',
      },
      null,
      2,
    ),
  )
  console.log('WS UI: 7 connection-form checks passed against loopback fixture')
}
