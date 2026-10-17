import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { browserScenario } from './browser-scenario.mjs'

/** Shared export UI and explicit synthetic preparation; download actions remain untouched. */
export async function checkExportScopeUi(context) {
  const { evaluate, output } = context,
    h = browserScenario(context),
    { root, waitFor, clickAt, button, setValue } = h
  const scope = `(${root}).querySelector('[data-archive-export-scope]')`
  const form = `(${root}).querySelector('.booster-export-dialog,[aria-label="Параметры пользовательского экспорта"]')`
  const radio = (value) => `(${scope}).querySelector('label[for$="-${value}"]')`
  const count = (expected) =>
    waitFor(
      `(${scope}).textContent.includes('Сообщений в экспорте: ${expected}')`,
      `Export scope count differs from ${expected}`,
    )
  const reports = []
  for (const product of ['vk', 'all-in-one-vk', 'chatgpt', 'all-in-one'])
    for (const width of [1365, 390]) {
      await h.navigate({ product, width, height: 1000, scene: 'long', view: 'archive' })
      await waitFor(`Boolean(${button('Экспорт')})`, 'Reader export action absent')
      await clickAt(button('Экспорт'))
      await waitFor(
        `Boolean(${scope})&&!(${scope}).textContent.includes('Загружаем список')`,
        'Shared export scope absent/loading',
      )
      await count(3000)
      await clickAt(radio('last'))
      for (const value of [50, 100, 1000]) {
        await clickAt(button(String(value), scope))
        await count(value)
      }
      await setValue(`(${scope}).querySelector('input[type=number]')`, '0')
      await waitFor(
        `(${scope}).textContent.includes('Укажите число сообщений больше нуля')`,
        'Invalid count accepted',
      )
      await clickAt(button('50', scope))
      await count(50)
      const format = `(${form}).querySelector('[data-archive-export-format-fields] [role=combobox]')`
      await clickAt(format)
      await clickAt(
        `([...(${root}).querySelectorAll('[role=option]')].find(e=>e.textContent.trim()==='JSON'))`,
      )
      await clickAt(button('Подготовить экспорт', form))
      if (product.endsWith('vk'))
        await waitFor(
          `(${form}).textContent.includes('Подготовлено сообщений: 50')`,
          'VK prepared export ignores latest N',
        )
      else {
        await waitFor(
          `Boolean((${form}).querySelector('a[download][href^="blob:"]'))`,
          'ChatGPT prepared artifact absent',
        )
        const artifact = await evaluate(
          `(async()=>{const rows=await(await fetch((${form}).querySelector('a[download]').href)).json();return {count:rows.length,first:rows[0]?.id,last:rows.at(-1)?.id}})()`,
        )
        if (
          artifact.count !== 50 ||
          artifact.first !== 'demo-msg-2951' ||
          artifact.last !== 'demo-msg-3000'
        )
          throw Error(`Latest N file differs: ${JSON.stringify(artifact)}`)
      }
      await clickAt(radio('dates'))
      await setValue(`(${scope}).querySelector('input[aria-label="С даты"]')`, '2025-10-10')
      await setValue(
        `(${scope}).querySelector('input[aria-label="По дату включительно"]')`,
        '2025-10-10',
      )
      await count(960)
      await setValue(`(${scope}).querySelector('input[aria-label="С даты"]')`, '2025-10-11')
      await waitFor(
        `(${scope}).textContent.includes('Начало периода должно быть не позже конца')`,
        'Reversed dates accepted',
      )
      await clickAt(radio('selected'))
      await count(0)
      await clickAt(`(${scope}).querySelector('[role=checkbox]')`)
      await count(1)
      const selected = await evaluate(
        `(${scope}).querySelector('[role=checkbox][aria-checked=true]')?.getAttribute('aria-label')`,
      )
      if (!selected) throw Error('Inline export selection did not retain its message')
      const bounds = await evaluate(
        `(()=>{const e=${scope},b=e.getBoundingClientRect();return {width:b.width,scroll:e.scrollWidth,client:e.clientWidth}})()`,
      )
      if (bounds.scroll > bounds.client + 1)
        throw Error(`Export scope overflows: ${JSON.stringify(bounds)}`)
      await h.screenshot(`export-scope-${product}-${width}`, width, 1000)
      reports.push({
        product,
        width,
        latestPresets: [50, 100, 1000],
        dateCount: 960,
        inlineSelection: 1,
        status: 'pass',
      })
    }
  await writeFile(
    join(output, 'export-scope-ui.json'),
    JSON.stringify({ status: 'pass', scope: 'synthetic-local-only', reports }, null, 2),
  )
  console.log(
    'Export scope UI: 8 cases passed: date ranges, latest N, inline selection and prepared artifacts',
  )
}
