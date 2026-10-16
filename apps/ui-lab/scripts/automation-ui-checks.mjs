import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { browserScenario } from './browser-scenario.mjs'

/** Focused settings regressions, always using the runner's disposable profile. */
export async function checkAutomationUi(context) {
  const { evaluate, output } = context
  const harness = browserScenario(context)
  const { root, button, labelled: field, setValue, click, clickAt, waitFor: wait } = harness
  const reports = []
  const navigate = (category, width, height) => harness.navigate({ category, width, height })
  async function geometry(name, width, height) {
    reports.push(await harness.geometry(name, width, height))
    await writeFile(join(output, 'automation-ui-partial.json'), JSON.stringify(reports, null, 2))
  }
  await navigate('triggers', 1440, 960)
  await click('Добавить правило')
  if (await evaluate(`Boolean(${field('Автор сообщения')})`))
    throw Error('Message fields visible for completion')
  await setValue(field('Название правила'), 'Синтетическое правило')
  await clickAt(field('Событие'))
  await wait(
    `Boolean([...(${root}).querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='Сообщение'))`,
    'Event options absent',
  )
  await clickAt(
    `([...(${root}).querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='Сообщение'))`,
  )
  await wait(`Boolean(${field('Автор сообщения')})`, 'Message fields absent')
  if (await evaluate(`Boolean(${field('Результат запроса')})`))
    throw Error('Completion fields visible for message')
  await setValue(field('Текст сообщения, необязательно'), 'READY')
  await evaluate(`${field('Учитывать регистр')}.click()`)
  await setValue(field('Минимальный интервал повторения, мс'), '0')
  await setValue(`(${root}).querySelector('textarea')`, 'Первая строка\nВторая строка')
  await click('Применить в памяти')
  await wait(
    `(${root}).textContent.includes('Есть изменения в памяти')`,
    'Draft was persisted implicitly',
  )
  await click('Изменить')
  const preserved = await evaluate(
    `({checked:(${field('Учитывать регистр')}).getAttribute('aria-checked'),text:(${root}).querySelector('textarea').value,cooldown:(${field('Минимальный интервал повторения, мс')}).value})`,
  )
  if (
    preserved.checked !== 'true' ||
    preserved.text !== 'Первая строка\nВторая строка' ||
    preserved.cooldown !== '0'
  )
    throw Error(`Editor lost fields ${JSON.stringify(preserved)}`)
  await geometry('desktop-trigger-editor', 1440, 960)
  await click('Отменить редактирование')
  await click('Сохранить изменения')
  await wait(`(${root}).textContent.includes('Все правила сохранены')`, 'Draft save did not persist')
  await click('Удалить')
  await wait(`(${root}).textContent.includes('Есть изменения в памяти')`, 'Delete bypassed draft')
  await click('Отменить изменения')
  await wait(
    `(${root}).textContent.includes('Синтетическое правило')&&(${root}).textContent.includes('Все правила сохранены')`,
    'Discard did not restore saved rules',
  )
  reports.push({
    name: 'draft-semantics',
    checks: [
      'conditional-event-fields',
      'apply-memory-only',
      'case-sensitive-preserved',
      'multiline-preserved',
      'zero-cooldown-preserved',
      'explicit-save',
      'delete-memory-only',
      'discard-restores-saved',
    ],
  })
  for (const [name, width, height] of [
    ['phone', 390, 844],
    ['tablet', 820, 1180],
    ['desktop', 1440, 960],
  ]) {
    await navigate('sounds', width, height)
    await geometry(`${name}-sounds`, width, height)
    await navigate('remote', width, height)
    await geometry(`${name}-remote`, width, height)
    await navigate('triggers', width, height)
    await click('Добавить правило')
    await geometry(`${name}-trigger-editor`, width, height)
  }
  await navigate('sounds', 390, 844)
  await evaluate(
    `(() => {const el=${field('Звуковые уведомления')};if(el.getAttribute('aria-checked')!=='true')el.click()})()`,
  )
  await evaluate(
    `(() => {const el=${field('Сигнал долгого запроса')};if(el.getAttribute('aria-checked')!=='true')el.click()})()`,
  )
  await setValue(field('Порог, секунд'), '', true)
  await wait(
    `(${root}).textContent.includes('Укажите целое число от 15 до 1800')`,
    'Invalid threshold accepted',
  )
  await setValue(field('Порог, секунд'), '31', true)
  await wait(
    `!(${root}).textContent.includes('Укажите целое число от 15 до 1800')`,
    'Valid threshold rejected',
  )
  reports.push({ name: 'sound-threshold', checks: ['empty-rejected', 'valid-number-accepted'] })
  await evaluate(`(${root}).querySelector('[data-settings-catalog-toggle]').click()`)
  await wait(
    `(${root}).querySelector('[data-settings-catalog-toggle]').getAttribute('aria-expanded')==='true'`,
    'Mobile catalog did not expand',
  )
  await wait(
    `Boolean(${button('Триггеры')})&&Boolean(${button('Сервер и синхронизация')})&&!Boolean(${button('Автоматизация')})&&Boolean((${root}).querySelector('[data-settings-section=sounds]'))`,
    'Automation sections must be directly available without an intermediate group',
  )
  await click('Триггеры')
  await wait(
    `Boolean((${root}).querySelector('[data-settings-section=triggers]'))&&(${root}).querySelector('[data-settings-catalog-toggle]').getAttribute('aria-expanded')==='false'`,
    'Leaf did not navigate and collapse mobile catalog',
  )
  await evaluate(`(${root}).querySelector('[data-settings-catalog-toggle]').click()`)
  await click('Сервер и синхронизация')
  await wait(
    `Boolean((${root}).querySelector('[data-settings-section=remote]'))&&(${root}).querySelector('[data-settings-catalog-toggle]').getAttribute('aria-expanded')==='false'`,
    'Direct server leaf did not navigate and collapse mobile catalog',
  )
  await evaluate(`(${root}).querySelector('[data-settings-catalog-toggle]').click()`)
  await click('Звуки')
  await wait(
    `Boolean((${root}).querySelector('[data-settings-section=sounds]'))&&(${root}).querySelector('[data-settings-catalog-toggle]').getAttribute('aria-expanded')==='false'`,
    'Direct sibling navigation did not restore sounds and collapse mobile catalog',
  )
  reports.push({
    name: 'mobile-settings-navigation',
    checks: [
      'explicit-expand',
      'direct-automation-leaves',
      'no-redundant-group',
      'leaf-select-and-collapse',
      'direct-server-leaf',
      'direct-sibling-navigation',
    ],
  })
  const aggregate = JSON.parse(await readFile(new URL('../../all-in-one.json', import.meta.url), 'utf8'))
  for (const product of ['all-in-one', 'all-in-one-vk']) {
    for (const [viewport, width, height] of [
      ['phone', 390, 844],
      ['tablet', 820, 1180],
    ]) {
      await harness.navigate({ category: 'interface', product, width, height })
      const identity = await evaluate(
        `(() => { const r=${root},panel=r.querySelector('.booster-modal-surface');const headings=[...panel.querySelectorAll('.booster-floating-identity,.booster-control-header .booster-header-copy')].filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0});return {count:headings.length,title:headings[0]?.textContent.trim(),versions:headings.flatMap(el=>[...el.querySelectorAll('.booster-version')].map(v=>v.textContent.trim())),shells:r.querySelectorAll('.booster-modal-surface').length};})()`,
      )
      if (
        identity.count !== 1 ||
        identity.shells !== 1 ||
        !identity.title.includes(aggregate.name) ||
        identity.versions.length !== 1 ||
        identity.versions[0] !== aggregate.version
      )
        throw Error(`Aggregate identity duplicated or wrong: ${JSON.stringify(identity)}`)
      reports.push({
        ...(await harness.geometry(
          `${product}-${viewport}-identity`,
          width,
          height,
          '.booster-control-center',
        )),
        identity,
      })
    }
  }
  await writeFile(
    join(output, 'automation-ui-focused.json'),
    JSON.stringify(
      { schemaVersion: 1, status: 'pass', scope: 'synthetic-local-only', reports },
      null,
      2,
    ),
  )
  console.log(
    'Automation UI: drafts, responsive settings, direct section navigation, aggregate identity and numeric validation passed',
  )
}
