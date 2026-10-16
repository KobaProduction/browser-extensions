import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { browserScenario } from './browser-scenario.mjs'

/** Check the lab's own task flow, separately from provider visual acceptance. */
export async function checkExplorer({ command, evaluate, baseUrl, output }) {
  const { clickAt } = browserScenario({ command, evaluate, baseUrl, output })
  const checks = []
  const check = async (name, expression) => {
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) {
      if (await evaluate(expression)) {
        checks.push(name)
        return
      }
      await delay(100)
    }
    throw Error(`Explorer check failed: ${name}`)
  }
  const click = (label) =>
    evaluate(`(() => {
    const label = ${JSON.stringify(label)};
    const button = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent.includes(label));
    const field = [...document.querySelectorAll('label')].find(item => item.textContent.trim().startsWith(label));
    const control = button || document.getElementById(field?.getAttribute('for')); if (!control) throw Error('Control not found'); control.click();
  })()`)
  const choose = async (label, value) => {
    await clickAt(`(() => {
    const field = [...document.querySelectorAll('label')].find(item => item.textContent.trim().startsWith(${JSON.stringify(label)}));
    return document.getElementById(field?.getAttribute('for'));
  })()`)
    const selector = `[role="option"][data-lab-value="${value}"]`
    await check(
      `Selector ${label} opens`,
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    )
    await clickAt(`document.querySelector(${JSON.stringify(selector)})`)
  }
  const noOverflow = 'document.documentElement.scrollWidth <= innerWidth + 1'
  const preview = "document.querySelector('iframe')?.contentWindow?.__uiLabPreviewReport"
  const shadow =
    "document.querySelector('iframe')?.contentDocument.querySelector('[id*=koba-browser-tools-root]')?.shadowRoot"
  const screenshot = async (name) => {
    const image = await command('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    await writeFile(join(output, `explorer-${name}.png`), Buffer.from(image.data, 'base64'))
  }
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1140,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await command('Page.navigate', { url: baseUrl })
  await check(
    'Map shows four directions without an iframe or scenario controls',
    "document.querySelectorAll('[data-lab-direction]').length === 4 && !document.querySelector('iframe, [role=combobox]')",
  )
  await check('Map fits desktop', noOverflow)
  await screenshot('map-desktop')
  await clickAt('document.querySelector(\'[data-lab-direction="archive"]\')')
  await check(
    'Archive route opens a saved fixture',
    `${preview}?.view === 'archive' && ${preview}?.shell`,
  )
  await check('Desktop preview fits the available space', noOverflow)
  await choose('Сценарий', 'empty')
  await check('Archive fixture selection is applied', `${preview}?.scene === 'empty'`)
  await click('All-in-one')
  await check(
    'Aggregate has a separate site selector',
    "[...document.querySelectorAll('label')].some(item => item.textContent.startsWith('Сайт для проверки'))",
  )
  await choose('Сайт для проверки', 'vk')
  await check(
    'Aggregate changes the host without changing the product list',
    `${preview}?.product === 'all-in-one-vk' && document.querySelectorAll('[id^=lab-product-][role=radio]').length === 3`,
  )
  await click('Телефон')
  await check(
    'Mobile preview fills its viewport without window controls',
    `(() => { const root = ${shadow}; const modal = root?.querySelector('.booster-modal-fullscreen'); const box = modal?.getBoundingClientRect(); return box?.width === 390 && box?.height === 780 && !root.querySelector('.booster-floating-chrome, .booster-floating-resize') })()`,
  )
  await screenshot('aggregate-mobile')
  await click('Карта проверок')
  await check(
    'Returning to the map removes the preview',
    "document.querySelectorAll('[data-lab-direction]').length === 4 && !document.querySelector('iframe')",
  )
  await evaluate('history.back()')
  await check(
    'Browser Back restores the archive direction',
    "location.hash === '#archive' && Boolean(document.querySelector('iframe'))",
  )
  await evaluate('history.forward()')
  await check(
    'Browser Forward restores the map',
    "!location.hash && document.querySelectorAll('[data-lab-direction]').length === 4 && !document.querySelector('iframe')",
  )
  await click('Модули и настройки')
  await click('ChatGPT Booster')
  await choose('Раздел', 'analytics')
  await check(
    'Settings section selection reaches the real component',
    `Boolean((${shadow})?.querySelector('[data-settings-section=analytics]'))`,
  )
  await choose('Раздел', 'modules')
  await click('Компьютер')
  await check(
    'Desktop modules use two columns',
    `(() => { const element = (${shadow})?.querySelector('[data-settings-section=modules]'); return element && getComputedStyle(element).gridTemplateColumns.split(' ').length === 2 })()`,
  )
  await screenshot('modules-desktop')
  await click('Планшет')
  await check(
    'Tablet modules use compact rows',
    `(() => { const element = (${shadow})?.querySelector('[data-settings-section=modules]'); return ${preview}?.width === 768 && element && getComputedStyle(element).gridTemplateColumns.split(' ').length === 1 })()`,
  )
  await screenshot('modules-tablet')
  await command('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await check('Lab itself fits a phone screen', noOverflow)
  await screenshot('lab-mobile')
  await click('Карта проверок')
  await check('Mobile map fits without overflow', noOverflow)
  await screenshot('map-mobile')
  await writeFile(
    join(output, 'explorer-checks.json'),
    JSON.stringify({ status: 'pass', checks }, null, 2),
  )
  console.log(`EXPLORER: ${checks.length} checks passed`)
}
