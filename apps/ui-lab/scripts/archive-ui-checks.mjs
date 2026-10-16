import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { browserScenario } from './browser-scenario.mjs'

/** Fixed synthetic saved records only: no history capture, network media or download actions. */
export async function checkArchiveUi(context) {
  const { command, evaluate, output } = context
  const h = browserScenario(context)
  const { root, waitFor, button, clickAt } = h
  const reader = `(${root})?.querySelector('.booster-reader')`
  const history = `(${root})?.querySelector('.booster-archive-flow-graph')`
  const reports = []
  async function showHistory() {
    const expanded = await evaluate(
      `${button('История', reader)}?.getAttribute('aria-expanded')==='true'`,
    )
    if (!expanded) await click('История', reader)
  }
  async function click(text, scope = root) {
    const target = button(text, scope)
    const archivedAction = ['Начало диапазона', 'Конец диапазона', 'Выбор сообщений'].includes(text)
    const actions = button('Действия', reader)
    const inPopover = archivedAction && (await evaluate(`Boolean(${reader})`))
    if (inPopover) {
      const open = await evaluate(`(${actions})?.getAttribute('aria-expanded')==='true'`)
      if (!open) await clickAt(actions)
      await waitFor(`Boolean(${target})`, `Archive action did not open: ${text}`)
    }
    await clickAt(target)
    if (inPopover)
      await waitFor(`!(${target})`, `Archive action overlay did not finish closing: ${text}`)
  }
  const currentPoint = (id) =>
    `Boolean((${history}).querySelector('[aria-current=true]')?.getAttribute('aria-label')?.includes(${JSON.stringify(`Синтетическое сообщение ${id.replace('demo-msg-', '')};`)}))`
  async function open(scene = 'long', width = 1440, height = 960, product = 'chatgpt') {
    await h.navigate({ scene, width, height, product, view: 'archive' })
    if (product === 'vk' || product === 'all-in-one-vk') return
    await waitFor(`Boolean(${reader})`, 'Saved Reader did not mount')
    if (width <= 640) {
      const conversation = `(${reader}).querySelector('.booster-reader-sidebar button[aria-current=true]')`
      await waitFor(`Boolean(${conversation})`, 'Phone archive has no saved conversation')
      await clickAt(conversation)
      await waitFor(
        `!(${reader}).classList.contains('booster-reader-list-mode')&&(${reader}).querySelector('.booster-reader-main').getBoundingClientRect().width>0`,
        'Phone conversation did not replace the archive list',
      )
    }
    await waitFor(
      `Boolean((${reader}).querySelector('[data-archive-message]'))`,
      'Saved messages did not load',
    )
  }
  async function point(id) {
    const preview = `Синтетическое сообщение ${id.replace('demo-msg-', '')};`
    const expression = `([...(${history})?.querySelectorAll('[data-archive-timeline-id]')||[]].find(el=>el.getAttribute('aria-label')?.includes(${JSON.stringify(preview)})))`
    try {
      await waitFor(`Boolean(${expression})`, `Timeline point missing: ${id}`)
    } catch (error) {
      await writeFile(
        join(output, 'archive-point-diagnostic.json'),
        JSON.stringify(
          await evaluate(
            `({id:${JSON.stringify(id)},points:[...(${history}).querySelectorAll('[data-archive-timeline-id]')].map(el=>({label:el.getAttribute('aria-label'),current:el.getAttribute('aria-current')})),value:(${history}).querySelector('[role=slider]').getAttribute('aria-valuenow'),summary:(${reader}).querySelector('.booster-reader-summary').textContent,targets:[...(${reader}).querySelectorAll('.booster-message-target')].map(el=>el.dataset.archiveMessage)})`,
          ),
          null,
          2,
        ),
      )
      throw error
    }
    await clickAt(expression)
    await waitFor(currentPoint(id), `Timeline selection did not reach ${id}`)
  }
  async function key(key, code) {
    await command('Page.bringToFront')
    await evaluate(
      `(() => {const slider=(${history}).querySelector('[role=slider]');slider.scrollIntoView({block:'nearest'});slider.focus({preventScroll:true})})()`,
    )
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    })
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
    })
  }
  async function phoneReaderBounds(name, height) {
    const metrics = await evaluate(
      `(() => {const r=${root},pane=${reader};const measure=el=>{const b=el.getBoundingClientRect();return {clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,x:b.x,y:b.y,width:b.width,height:b.height}};const selectors=['.booster-settings-content','.booster-reader','.booster-reader-main','.booster-reader-reading-surface','.booster-reader-scroll'];return {panes:Object.fromEntries(selectors.map(selector=>[selector,measure(r.querySelector(selector))])),catalogVisible:r.querySelector('.settings-catalog').getBoundingClientRect().height>0,focus:pane.dataset.panelContentFocus,overflowing:[...pane.querySelectorAll('*')].filter(el=>el.clientWidth&&el.scrollWidth>el.clientWidth+1).slice(0,20).map(el=>({tag:el.tagName,class:el.className,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth}))}})()`,
    )
    await writeFile(join(output, `${name}-pane.json`), JSON.stringify(metrics, null, 2))
    const overflow = Object.entries(metrics.panes).filter(
      ([, pane]) => pane.scrollWidth > pane.clientWidth + 1,
    )
    if (overflow.length || metrics.catalogVisible || metrics.focus !== 'true')
      throw Error(`Phone Reader scroll/focus ownership differs: ${JSON.stringify(metrics)}`)
    if (
      metrics.panes['.booster-reader'].height < height - 180 ||
      metrics.panes['.booster-reader-scroll'].height < 180
    )
      throw Error(`Phone Reader did not receive useful reading height: ${JSON.stringify(metrics)}`)
    return metrics
  }
  async function workspaceBounds(name) {
    await waitFor(
      `Boolean((${reader}).querySelector('.booster-reader-branch-navigation'))`,
      'Saved path metadata did not finish loading',
    )
    const metrics = await evaluate(
      `(() => {const r=${root},pane=${reader},measure=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}};return {outer:measure(r.querySelector('.booster-settings-content')),context:measure(r.querySelector('.booster-archive-context-actions')),reader:measure(pane),main:measure(pane.querySelector('.booster-reader-main')),toolbar:measure(pane.querySelector('.booster-reader-pinned')),reading:measure(pane.querySelector('.booster-reader-reading-surface')),transcript:measure(pane.querySelector('.booster-reader-scroll'))}})()`,
    )
    await writeFile(join(output, `${name}-workspace.json`), JSON.stringify(metrics, null, 2))
    const widths = ['outer', 'reader', 'main', 'toolbar', 'reading', 'transcript']
    if (widths.some((key) => metrics[key].scrollWidth > metrics[key].clientWidth + 1))
      throw Error(`Archive outer pane overflows: ${JSON.stringify(metrics)}`)
    if (
      Math.abs(metrics.reader.bottom - metrics.outer.bottom) > 2 ||
      metrics.reader.height < metrics.outer.height - metrics.context.height - 4 ||
      metrics.toolbar.bottom > metrics.reading.y + 1 ||
      metrics.toolbar.scrollHeight > metrics.toolbar.clientHeight + 1 ||
      metrics.transcript.height < 180
    )
      throw Error(
        `Archive did not fill the remaining area or toolbar is clipped: ${JSON.stringify(metrics)}`,
      )
    return metrics
  }
  for (const [name, width, height] of [
    ['owner-desktop', 1063, 1173],
    ['desktop', 1365, 780],
    ['tablet', 820, 1180],
    ['phone', 390, 844],
  ]) {
    await open('saved', width, height)
    const workspace = await workspaceBounds(`archive-${name}`)
    await h.screenshot(`archive-${name}-workspace`, width, height)
    reports.push({
      name: `${name}-available-workspace`,
      workspace,
      checks: [
        'fill-to-outer-bottom',
        'toolbar-not-clipped-or-overlapping',
        'no-outer-horizontal-overflow',
        'useful-transcript-height',
      ],
    })
  }
  await open()
  const initial = await evaluate(
    `({summary:(${reader}).querySelector('.booster-reader-summary').textContent,rendered:(${reader}).querySelectorAll('[data-archive-message]').length})`,
  )
  if (!/Загружено\s+160\/3000/.test(initial.summary) || initial.rendered > 160)
    throw Error(`Reader did not start with a bounded page: ${JSON.stringify(initial)}`)
  await showHistory()
  await waitFor(
    `Boolean((${history})?.querySelector('[role=slider]'))`,
    'Vertical timeline did not mount',
  )
  const timeline = await evaluate(
    `({count:(${history}).querySelectorAll('[data-archive-timeline-id]').length,max:(${history}).querySelector('[role=slider]').getAttribute('aria-valuemax')})`,
  )
  if (timeline.max !== '2999' || timeline.count > 160)
    throw Error(`Timeline dropped metadata or rendered all rows: ${JSON.stringify(timeline)}`)
  // Begin away from the minimum: Reka correctly emits commits only for changed values.
  await key('End', 35)
  await waitFor(currentPoint('demo-msg-3000'), 'Timeline End did not open the latest message')
  await key('Home', 36)
  await waitFor(currentPoint('demo-msg-1'), 'Timeline Home did not open first message')
  await point('demo-msg-10')
  await click('Начало диапазона')
  await point('demo-msg-20')
  await click('Конец диапазона')
  await waitFor(
    `Boolean([...(${reader}).querySelectorAll('button')].find(el=>el.textContent.trim().startsWith('Экспорт выбранных')&&el.textContent.trim().endsWith('· 11')))`,
    'Range did not select all eleven saved records',
  )
  const selected = await evaluate(`(${history}).querySelectorAll('[data-selected=true]').length`)
  if (selected !== 11) throw Error(`Timeline range markers differ: ${selected}`)
  await key('End', 35)
  await waitFor(currentPoint('demo-msg-3000'), 'Timeline End did not open last message')
  await click('Середина')
  await waitFor(
    `(() => { const ids=[...(${reader}).querySelectorAll('[data-archive-message]')].map(el=>Number(el.dataset.archiveMessage.replace('demo-msg-',''))); return ids.length>0&&Math.min(...ids)>1300&&Math.max(...ids)<1700 })()`,
    'Middle position did not replace the bounded Reader window',
  )
  await click('К первым сохранённым')
  await waitFor(
    `Boolean((${reader}).querySelector('[data-archive-message="demo-msg-1"]'))`,
    'First known position did not show first message',
  )
  await click('Следующие сообщения')
  await waitFor(
    `(() => { const text=(${reader}).querySelector('.booster-reader-summary').textContent; const count=Number(text.split('Загружено')[1]?.trim().split('/')[0]); return count>160&&count<=640 })()`,
    'Progressive page navigation did not add a bounded next page',
  )
  await click('К последним')
  await waitFor(
    `Boolean((${reader}).querySelector('[data-archive-message="demo-msg-3000"]'))`,
    'Latest position did not show last message',
  )
  reports.push({
    name: 'long-chatgpt-reader',
    initial,
    timeline,
    checks: [
      'bounded-first-page',
      'bounded-metadata-timeline',
      'keyboard-first',
      'range-inclusive-eleven',
      'selected-timeline-markers',
      'keyboard-last',
      'middle-window',
      'first-position',
      'progressive-next-page',
      'latest-position',
    ],
  })
  await h.screenshot('archive-long-timeline', 1440, 960)

  await open('saved')
  await click('К первым сохранённым')
  await waitFor(
    `Boolean((${reader}).querySelector('[data-archive-message="demo-msg-1"]'))`,
    'Small archive first position unavailable',
  )
  const branchSelect = `([...(${reader}).querySelectorAll('[role=combobox]')].find(el=>el.closest('label')?.textContent.includes('Путь чтения')))`
  await clickAt(branchSelect)
  const branchOption = `([...(${root}).querySelectorAll('[role=option]')].find(el=>el.textContent.includes('Ветка 1')))`
  await waitFor(`Boolean(${branchOption})`, 'Branch selector has no saved path')
  const branchOptions = await evaluate(
    `[...(${root}).querySelectorAll('[role=option]')].map(el=>el.textContent.trim())`,
  )
  if (
    branchOptions.length !== 3 ||
    !branchOptions.some((label) => /Ветка\s+1\s+из\s+2/.test(label)) ||
    !branchOptions.some((label) => /Ветка\s+2\s+из\s+2/.test(label))
  )
    throw Error(
      `One stored fork must expose two saved paths, not message versions: ${JSON.stringify(branchOptions)}`,
    )
  await clickAt(branchOption)
  await waitFor(`Boolean(${button('Экспорт ветки')})`, 'Saved branch was not activated')
  await waitFor(
    `(() => {const r=${reader},select=${branchSelect};if(!select||select.disabled||r.getAttribute('aria-busy')!=='false'||!r.querySelector('.booster-reader-summary').textContent.includes('В выбранном пути: 8'))return false;const ids=[...new Set([...r.querySelectorAll('[data-archive-message]')].map(el=>el.dataset.archiveMessage))];return ids.length===8&&ids.every(id=>/^demo-msg-[1-8]$/.test(id))})()`,
    'Selected path did not finish loading all eight records while excluding the sibling tail',
  )
  const branchIds = await evaluate(
    `[...(${reader}).querySelectorAll('[data-archive-message]')].map(el=>el.dataset.archiveMessage)`,
  )
  if (!branchIds.length || branchIds.some((id) => Number(id.replace('demo-msg-', '')) > 8))
    throw Error(`Reader includes records outside selected saved branch: ${branchIds}`)
  await h.screenshot('archive-saved-branch', 1440, 960)
  reports.push({
    name: 'saved-branch',
    messageIds: branchIds,
    checks: ['branch-selector', 'saved-path-filter', 'branch-export-scope'],
  })

  await showHistory()
  await point('demo-msg-8')
  await click('История')
  await clickAt(button('Действия', reader))
  const versionsAction = `([...(${root}).querySelectorAll('.booster-reader-action-menu button')].find(el=>el.textContent.trim().startsWith('Версии сообщения')))`
  await waitFor(`Boolean(${versionsAction})`, 'Message versions action is not available')
  await clickAt(versionsAction)
  const versions = `(${reader}).querySelector('.booster-reader-versions')`
  await waitFor(
    `Boolean((${versions})?.querySelector('[role=combobox]'))&&(${versions}).dataset.versionMessage==='demo-msg-8'`,
    'Explicit message-eight version inspection did not keep its target',
  )
  await clickAt(`(${versions}).querySelector('[role=combobox]')`)
  await waitFor(
    `(${root}).querySelectorAll('[role=option]').length===2`,
    'Synthetic version count changed',
  )
  await clickAt(`(${root}).querySelector('[role=option]')`)
  await waitFor(
    `(${versions}).dataset.versionMessage==='demo-msg-8'&&(${versions}).textContent.includes('Синтетическое сообщение 8')&&!(${versions}).textContent.includes('здесь нет пользовательских данных')`,
    'Earlier saved version was not displayed',
  )
  reports.push({
    name: 'saved-message-version',
    checks: ['two-original-variants', 'read-only-version-switch'],
  })
  await clickAt(`(${reader}).querySelector('.booster-reader-fork-toggle')`)
  const siblingGroup = `(${root}).querySelector('[data-branch-parent="demo-msg-6"]')`
  await waitFor(`Boolean(${siblingGroup})`, 'Stored sibling parent is not shown')
  const siblingIds = await evaluate(
    `[...(${siblingGroup}).querySelectorAll('[data-branch-message]')].map(el=>el.dataset.branchMessage).sort()`,
  )
  if (JSON.stringify(siblingIds) !== JSON.stringify(['demo-msg-7', 'demo-msg-9']))
    throw Error(
      `Branch navigation substituted variants for explicit sibling IDs: ${JSON.stringify(siblingIds)}`,
    )
  await clickAt(`(${siblingGroup}).querySelector('[data-branch-message="demo-msg-9"]')`)
  await waitFor(
    `Boolean((${reader}).querySelector('[data-archive-message="demo-msg-9"]'))&&(${branchSelect}).textContent.includes('Все сохранённые пути')`,
    'Sibling navigation did not release the previous path and show the other branch',
  )
  await clickAt(branchSelect)
  const secondBranch = `([...(${root}).querySelectorAll('[role=option]')].find(el=>el.textContent.includes('Ветка 2 из 2')))`
  await waitFor(`Boolean(${secondBranch})`, 'Second stored branch was not available')
  await clickAt(secondBranch)
  await waitFor(
    `Boolean((${reader}).querySelector('[data-archive-message="demo-msg-32"]'))&&!(${reader}).querySelector('[data-archive-message="demo-msg-7"],[data-archive-message="demo-msg-8"]')`,
    'Second branch did not preserve its own ancestry and exclude the sibling tail',
  )
  reports.push({
    name: 'actual-sibling-branches',
    siblingIds,
    branchOptions,
    checks: [
      'one-fork-two-paths',
      'explicit-sibling-ids-seven-nine',
      'sibling-navigation-releases-path',
      'second-path-excludes-first-tail',
      'source-versions-remain-separate',
    ],
  })

  for (const [name, width, height] of [
    ['phone', 390, 844],
    ['tablet', 820, 1180],
  ]) {
    await open('saved', width, height)
    await showHistory()
    await waitFor(
      `Boolean(${history})&&(${history}).getBoundingClientRect().height>0&&(${history}).getBoundingClientRect().width>0`,
      `${name} history did not become visible`,
    )
    let pane
    if (name === 'phone') {
      pane = await phoneReaderBounds('archive-phone', height)
      await clickAt(button('Диалоги', reader))
      await waitFor(
        `(${root}).querySelector('.settings-catalog').getBoundingClientRect().height>0&&(${reader}).dataset.panelContentFocus==='false'`,
        'Phone Back did not restore the shared catalog and saved dialog list',
      )
      await clickAt(`(${reader}).querySelector('.booster-reader-sidebar button[aria-current=true]')`)
      await waitFor(
        `(${reader}).dataset.panelContentFocus==='true'`,
        'Phone saved dialog did not restore focused reading',
      )
      await waitFor(
        `(${reader}).getAttribute('aria-busy')==='false'&&Boolean((${history})?.querySelector('[aria-current=true]'))`,
        'Phone saved dialog read did not finish after Back',
      )
      const historyExpanded = await evaluate(
        `${button('История', reader)}.getAttribute('aria-expanded')==='true'`,
      )
      if (!historyExpanded) await click('История', reader)
      await key('Home', 36)
      await waitFor(currentPoint('demo-msg-1'), 'Phone first-message navigation did not settle')
      await point('demo-msg-1')
      await waitFor(
        `(() => {const message=(${reader}).querySelector('[data-archive-message="demo-msg-1"]'),viewport=(${reader}).querySelector('.booster-reader-scroll');if(!message)return false;const m=message.getBoundingClientRect(),v=viewport.getBoundingClientRect();return m.bottom>v.top&&m.top<v.bottom&&m.right<=v.right+1})()`,
        'Phone timeline did not keep the selected saved message reachable',
      )
      pane = await phoneReaderBounds('archive-phone', height)
    }
    reports.push({
      ...(await h.geometry(`archive-${name}`, width, height, '.booster-reader')),
      ...(pane
        ? {
            pane,
            checks: [
              'bounded-outer-scroll',
              'reader-height',
              'back-restores-catalog',
              'timeline-message-reachable',
            ],
          }
        : {}),
    })
  }
  await open('loading', 390, 844)
  await click('К первым сохранённым')
  await waitFor(
    `Boolean((${reader}).querySelector('.booster-reader-scroll [role=status][aria-label="Чтение локального архива…"] .animate-pulse'))`,
    'Loading phase has no registry Skeleton',
  )
  await h.screenshot('archive-phone-loading', 390, 844)
  await waitFor(
    `Boolean((${reader}).querySelector('[data-archive-message="demo-msg-1"]'))`,
    'Skeleton did not resolve into saved records',
  )
  reports.push({
    name: 'progressive-loading',
    checks: ['registry-skeleton-visible', 'records-replace-skeleton'],
  })

  await open('long', 1440, 960, 'vk')
  const vk = `(${root}).querySelector('[data-provider-view=reader]')`
  await waitFor(
    `Boolean((${vk})?.querySelector('[data-archive-message="1001"]'))`,
    'VK saved Reader did not load first page',
  )
  const vkTimeline = `(${vk}).querySelector('[aria-label="Таймлайн всех сохранённых сообщений VK"]')`
  await waitFor(
    `Boolean((${vkTimeline})?.querySelector('[role=slider]'))`,
    'VK metadata timeline did not load',
  )
  const coverageToggle = `([...(${vk}).querySelectorAll('button')].find(el=>el.textContent.trim().startsWith('Сохранено ')))`
  if (await evaluate(`(${coverageToggle}).getAttribute('aria-expanded')!=='true'`))
    await clickAt(coverageToggle)
  const vkInitial = await evaluate(
    `({rows:(${vk}).querySelectorAll('[data-archive-message]').length,points:(${vkTimeline}).querySelectorAll('[data-archive-timeline-id]').length,max:(${vkTimeline}).querySelector('[role=slider]').getAttribute('aria-valuemax'),unknown:(${vk}).textContent.includes('Полнота удалённой истории не подтверждена')})`,
  )
  if (vkInitial.rows !== 80 || vkInitial.points > 160 || vkInitial.max !== '2999' || !vkInitial.unknown)
    throw Error(`VK bounded/unknown coverage state differs: ${JSON.stringify(vkInitial)}`)
  await click('Выбор сообщений')
  await clickAt(`(${vkTimeline}).querySelector('[data-archive-timeline-id="1001"]')`)
  await waitFor(
    `Boolean((${vkTimeline}).querySelector('[data-archive-timeline-id="1001"][aria-current=true]'))`,
    'VK range start did not select the first saved record',
  )
  await click('Начало диапазона')
  await click('Следующие 80')
  await waitFor(
    `Boolean((${vk}).querySelector('[data-archive-message="1081"]'))`,
    'VK next page did not load',
  )
  await clickAt(`(${vkTimeline}).querySelector('[data-archive-timeline-id="1085"]')`)
  await waitFor(
    `Boolean((${vkTimeline}).querySelector('[data-archive-timeline-id="1085"][aria-current=true]'))`,
    'VK timeline did not activate the range endpoint',
  )
  await click('Конец диапазона')
  await waitFor(
    `(${vk}).textContent.includes('Выбрано сообщений: 85')`,
    'VK range omitted records outside rendered page',
  )
  const rangeMarkers = await evaluate(
    `(() => {const points=[...(${vkTimeline}).querySelectorAll('[data-archive-timeline-id]')];return {expected:points.filter(point=>Number(point.dataset.archiveTimelineId)>=1001&&Number(point.dataset.archiveTimelineId)<=1085).length,selected:points.filter(point=>point.dataset.selected==='true').length}})()`,
  )
  if (!rangeMarkers.expected || rangeMarkers.selected !== rangeMarkers.expected)
    throw Error(
      `VK timeline does not highlight the visible selected range: ${JSON.stringify(rangeMarkers)}`,
    )
  await click('Следующие 80')
  await waitFor(
    `Boolean((${vk}).querySelector('[data-archive-message="1161"]'))&&(${vk}).textContent.includes('Выбрано сообщений: 85')`,
    'VK selection did not survive pagination',
  )
  await clickAt(
    `([...(${vk}).querySelectorAll('button')].find(el=>el.textContent.startsWith('Последнее сохранённое')))`,
  )
  await waitFor(
    `Boolean((${vk}).querySelector('[data-archive-message="4000"]'))`,
    'VK last boundary did not open last saved record',
  )
  reports.push({
    name: 'vk-cross-page-range',
    initial: vkInitial,
    rangeMarkers,
    checks: [
      'eighty-row-page',
      'bounded-three-thousand-point-timeline',
      'unknown-remote-completeness',
      'range-across-pages-85',
      'visible-selected-timeline-markers',
      'selection-survives-pagination',
      'last-saved-boundary',
    ],
  })
  await h.screenshot('archive-vk-cross-page-range', 1440, 960)

  // Capture actions below use only the in-memory mock API and never fetch the site.
  await clickAt(
    `([...(${root}).querySelectorAll('.settings-catalog button')].find(el=>el.getBoundingClientRect().width>0&&el.textContent.trim()==='Выгрузка'))`,
  )
  await click('Последние N')
  await h.setValue(`(${root}).querySelector('input[type=number]')`, '5', true)
  await click('Собрать последние сообщения')
  await waitFor(
    `(${root}).textContent.includes('Обход частичный: можно продолжить повторным сбором.')`,
    'Synthetic limited capture claimed completeness',
  )
  await click('Вся история')
  await click('Собрать всю историю')
  await waitFor(
    `(${root}).textContent.includes('Обход доступной истории завершён.')`,
    'Synthetic full scan did not finish',
  )
  await clickAt(
    `([...(${root}).querySelectorAll('.settings-catalog button')].find(el=>el.getBoundingClientRect().width>0&&el.textContent.trim()==='Архив'))`,
  )
  await waitFor(`Boolean(${coverageToggle})`, 'VK coverage summary did not load')
  if (await evaluate(`(${coverageToggle}).getAttribute('aria-expanded')!=='true'`))
    await clickAt(coverageToggle)
  await waitFor(
    `(${root}).textContent.includes('Наблюдаемый обход VK подтверждён')`,
    'Completed synthetic scan did not refresh boundary evidence',
  )
  reports.push({
    name: 'synthetic-capture-evidence',
    checks: ['limited-scan-partial', 'full-scan-complete', 'reader-evidence-after-commit'],
  })
  for (const [product, width, height] of [
    ['vk', 390, 844],
    ['all-in-one', 820, 1180],
    ['all-in-one-vk', 820, 1180],
    ['all-in-one', 390, 844],
  ]) {
    await open('saved', width, height, product)
    if (product === 'all-in-one') {
      await showHistory()
      const name = width <= 620 ? `archive-${product}-phone` : `archive-${product}`
      if (width <= 620) {
        await key('Home', 36)
        await waitFor(
          currentPoint('demo-msg-1'),
          'Aggregate phone first-message navigation did not settle',
        )
        await point('demo-msg-1')
        const pane = await phoneReaderBounds(name, height)
        reports.push({ ...(await h.geometry(name, width, height, '.booster-reader')), pane })
      } else reports.push(await h.geometry(name, width, height, '.booster-reader'))
    } else {
      await waitFor(
        `Boolean((${root}).querySelector('[data-archive-message="1001"]'))`,
        `${product} Reader did not load`,
      )
      reports.push(await h.geometry(`archive-${product}`, width, height, '[data-provider-view=reader]'))
    }
  }
  await writeFile(
    join(output, 'archive-ui.json'),
    JSON.stringify(
      { schemaVersion: 1, status: 'pass', scope: 'synthetic-local-only', reports },
      null,
      2,
    ),
  )
  console.log(
    'Archive UI: bounded timeline, first/middle/last, saved range, branches, responsive layout and loading passed',
  )
}
