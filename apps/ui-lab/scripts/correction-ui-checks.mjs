import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { browserScenario } from './browser-scenario.mjs'

/** Owner's follow-up: composition-aware settings and one common language authority. */
export async function checkCorrectionUi(context) {
  const { evaluate, output } = context
  const h = browserScenario(context)
  const { root, navigate, clickAt, waitFor, button } = h
  const results = []
  for (const product of ['chatgpt', 'all-in-one', 'vk', 'all-in-one-vk']) {
    await navigate({ product, category: 'interface', width: 1063, height: 1173 })
    const groups = await evaluate(
      `([...(${root}).querySelectorAll('.settings-catalog [role=tab]')].filter(el=>el.getBoundingClientRect().width>0).map(el=>el.textContent.trim()))`,
    )
    if (groups.length < 2 || groups[0] === 'Общие настройки' || groups.at(-1) !== 'Общие настройки')
      throw Error(`${product}: capabilities must precede common settings: ${JSON.stringify(groups)}`)
    const commonGroup = `(${root}).querySelector('.settings-catalog [role=tab][data-state=active]')`
    const management = await evaluate(
      `Boolean([...(${root}).querySelectorAll('.settings-catalog button')].find(el=>el.textContent.trim()==='Модули и интеграции'))`,
    )
    if (management !== product.startsWith('all-in-one'))
      throw Error(`${product}: incorrect product-management catalog`)
    const language = `(${root}).querySelector('[data-shell-settings] [role=combobox]')`
    await clickAt(language)
    await clickAt(
      `([...(${root}).querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='English'))`,
    )
    await waitFor(
      `(${root}).querySelector('[data-shell-settings] h2')?.textContent==='Interface and display'`,
      'Common language did not update',
    )
    if (product === 'chatgpt' || product === 'all-in-one') {
      const providerTab = `([...(${root}).querySelectorAll('.settings-catalog [role=tab]')].find(el=>el!==${commonGroup}))`
      await clickAt(providerTab)
      await waitFor(
        `Boolean((${root}).querySelector('[data-settings-section=archive]'))`,
        'Provider settings did not open',
      )
      const navigation = await evaluate(
        `([...(${root}).querySelectorAll('.settings-catalog button')].map(el=>el.textContent.trim()))`,
      )
      if (
        !navigation.includes('Triggers') ||
        !navigation.includes('Server and sync') ||
        navigation.some((label) => /[А-Яа-яЁё]/.test(label))
      )
        throw Error(`${product}: automation still nested or missing`)
      await clickAt(button('Modules'))
      await waitFor(
        `(${root}).querySelector('[data-settings-section=modules]')?.getAttribute('lang')==='en' || (${root}).querySelector('.booster-control-embedded')?.getAttribute('lang')==='en'`,
        'Provider did not inherit common language',
      )
      const duplicateLanguage = await evaluate(
        `Boolean([...(${root}).querySelectorAll('[data-settings-section] [role=combobox]')].find(el=>el.getAttribute('aria-label')==='Language'))`,
      )
      if (duplicateLanguage) throw Error(`${product}: duplicate provider language preference`)
    } else {
      const providerTab = `([...(${root}).querySelectorAll('.settings-catalog [role=tab]')].find(el=>el.getBoundingClientRect().width>0&&el!==${commonGroup}))`
      await clickAt(providerTab)
      for (const [label, view] of [
        ['Capture', 'capture'],
        ['Archive', 'reader'],
        ['Parameters', 'settings'],
      ]) {
        const leaf = `([...(${root}).querySelectorAll('.settings-catalog button')].find(el=>el.getBoundingClientRect().width>0&&el.textContent.trim()===${JSON.stringify(label)}))`
        await clickAt(leaf)
        await waitFor(
          `Boolean((${root}).querySelector('[data-provider-view=${view}]'))&&(${leaf}).getAttribute('aria-current')==='page'`,
          `${product}: VK route and selected leaf differ: ${label}`,
        )
        const active = await evaluate(
          `([...(${root}).querySelectorAll('.settings-catalog [role=tab][data-state=active]')].filter(el=>el.getBoundingClientRect().width>0).map(el=>el.textContent.trim()))`,
        )
        if (active.length !== 1 || /Общие настройки|General/.test(active[0]))
          throw Error(`${product}: workflow lost its capabilities group: ${JSON.stringify(active)}`)
      }
      const noise = await evaluate(
        `Boolean([...(${root}).querySelectorAll('button')].find(el=>/Обновить Reader|Сохранение переписки/.test(el.textContent)))`,
      )
      if (noise) throw Error(`${product}: redundant VK navigation is still visible`)
    }
    await h.screenshot(`correction-${product}`, 1063, 1173)
    results.push({ product, groups, management, commonLanguage: 'en', status: 'PASS' })
  }
  await writeFile(join(output, 'correction-ui.json'), JSON.stringify(results, null, 2))
  console.log(`CORRECTION UI: ${results.length} composition/language scenarios PASS`)
}
