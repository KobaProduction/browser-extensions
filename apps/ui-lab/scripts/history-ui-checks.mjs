import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { browserScenario } from './browser-scenario.mjs'

/** Public synthetic UI. Never clicks a download link or fetches provider media. */
export async function checkHistoryUi(context) {
  const { command, evaluate, output } = context
  const h = browserScenario(context)
  const { root, navigate, waitFor, clickAt, button } = h
  const rail = `(${root}).querySelector('[data-archive-timeline-rail]')`
  const slider = `(${rail})?.querySelector('[role=slider]')`
  const preview = `(${root}).querySelector('[data-archive-timeline-preview][data-state=delayed-open], [data-archive-timeline-preview][data-state=instant-open]')`
  const surface = `(${root}).querySelector('[data-archive-reading-surface]')`
  const historyToggle = `([...(${root}).querySelectorAll('button[aria-label]')].find(el=>/^(Показать|Скрыть) историю/.test(el.getAttribute('aria-label'))))`
  const reports = []
  async function open(product, width, height, scene = 'saved') {
    await navigate({ product, width, height, scene, view: 'archive' })
    if (!product.endsWith('vk') && width <= 640 && scene !== 'empty') {
      const conversation = `(${root}).querySelector('.booster-reader-sidebar button[aria-current=true]')`
      await waitFor(`Boolean(${conversation})`, 'Saved phone conversation is absent')
      await clickAt(conversation)
    }
    if (scene !== 'empty')
      await waitFor(
        `Boolean(${slider})&&Boolean((${root}).querySelector('[data-archive-message]'))`,
        `${product}: shared rail/records did not mount`,
      )
  }
  async function visiblePreview(label) {
    await waitFor(`Boolean(${preview})&&(${preview}).getBoundingClientRect().width>0`, label)
    await waitFor(
      `(${preview})?.getAnimations().every(animation=>animation.playState!=='running')`,
      'Preview did not finish entering',
    )
    const detail = await evaluate(
      `(() => {const el=${preview},b=el.getBoundingClientRect();return {id:el.dataset.archiveTimelinePreviewId,text:el.textContent.trim(),x:b.x,right:b.right,y:b.y,bottom:b.bottom}})()`,
    )
    if (
      !detail.id ||
      !detail.text ||
      detail.x < -1 ||
      detail.right > (await evaluate('innerWidth+1')) ||
      detail.y < -1 ||
      detail.bottom > (await evaluate('innerHeight+1'))
    )
      throw Error(`Preview outside viewport: ${JSON.stringify(detail)}`)
    return detail
  }
  async function key(key, code) {
    await evaluate(`(${slider}).focus({preventScroll:true})`)
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
  for (const product of ['chatgpt', 'vk', 'all-in-one', 'all-in-one-vk']) {
    for (const [name, width, height] of [
      ['phone', 390, 844],
      ['tablet', 820, 1180],
      ['desktop', 1365, 780],
      ['owner', 1063, 1173],
    ]) {
      await open(product, width, height)
      const metrics = await evaluate(
        `(() => {const pane=${surface},r=${rail},transcript=pane.querySelector('[data-archive-reading-transcript]'),measure=el=>{const b=el.getBoundingClientRect();return {x:b.x,right:b.right,y:b.y,bottom:b.bottom,width:b.width,height:b.height,client:el.clientWidth,scroll:el.scrollWidth}};return {surface:measure(pane),rail:measure(r),transcript:measure(transcript),points:r.querySelectorAll('[data-archive-timeline-id]').length,duplicatedText:[...r.querySelectorAll('[data-archive-timeline-id]')].some(el=>el.textContent.trim()),label:(${slider}).getAttribute('aria-label')}})()`,
      )
      if (
        Math.abs(metrics.rail.width - 80) > 1 ||
        metrics.rail.x < metrics.transcript.right ||
        Math.abs(metrics.rail.y - metrics.transcript.y) > 1 ||
        metrics.transcript.height < 150 ||
        metrics.surface.scroll > metrics.surface.client + 1 ||
        metrics.rail.bottom > metrics.surface.bottom + 1 ||
        metrics.points > 160 ||
        metrics.duplicatedText ||
        !metrics.label
      )
        throw Error(`${product}/${name}: shared reading layout differs: ${JSON.stringify(metrics)}`)
      const hover = await evaluate(
        `(() => {const p=(${rail}).querySelector('[data-archive-timeline-id][aria-current=true]')||(${rail}).querySelector('[data-archive-timeline-id]'),b=p.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,id:p.dataset.archiveTimelineId}})()`,
      )
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover.x, y: hover.y })
      const hovered = await visiblePreview(`${product}/${name}: hover preview absent`)
      if (hovered.id !== hover.id) throw Error('Point preview shows a different saved message')
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
      await key('Home', 36)
      await waitFor(
        `(${rail}).getAttribute('aria-busy')!=='true'&&(${rail}).querySelector('[data-archive-timeline-id][aria-current=true]')?.dataset.archiveTimelineId===(${rail}).querySelector('[data-archive-timeline-id]')?.dataset.archiveTimelineId`,
        `${product}: Home read did not finish`,
      )
      const focused = await visiblePreview(`${product}/${name}: focus preview absent`)
      const min = await evaluate(`Number((${slider}).getAttribute('aria-valuenow'))`)
      if (min !== 0) throw Error(`${product}: keyboard Home did not reach first record`)
      await key('End', 35)
      await waitFor(
        `(${slider}).getAttribute('aria-valuenow')===(${slider}).getAttribute('aria-valuemax')`,
        `${product}: End did not reach last record`,
      )
      await waitFor(
        `(${rail}).getAttribute('aria-busy')!=='true'&&(${rail}).querySelector('[data-archive-timeline-id][aria-current=true]')?.dataset.archiveTimelineId===[...(${rail}).querySelectorAll('[data-archive-timeline-id]')].at(-1)?.dataset.archiveTimelineId`,
        `${product}: End read did not finish`,
      )
      // A real touch drag must change both the nearest preview and the transcript.
      await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      const drag = await evaluate(
        `(() => {const s=${slider},b=s.getBoundingClientRect(),track=s.parentElement.closest('[data-orientation=vertical]').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2,to:track.y+track.height*0.37}})()`,
      )
      await writeFile(
        join(output, `drag-${product}-${name}.json`),
        JSON.stringify({ drag, dom: await evaluate(`(${slider}).parentElement.outerHTML`) }, null, 2),
      )
      await evaluate(
        `(() => {window.__historyGestureTrace=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])(${root}).addEventListener(type,event=>{if(window.__historyGestureTrace.length>=40)return;const item={type,pointer:event.pointerType,target:event.target.getAttribute?.('role'),x:event.clientX,y:event.clientY,value:(${slider})?.getAttribute('aria-valuenow')};window.__historyGestureTrace.push(item);setTimeout(()=>{item.after=(${slider})?.getAttribute('aria-valuenow')},0)},{capture:true})})()`,
      )
      await command('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: drag.x, y: drag.y }],
      })
      await command('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: drag.x, y: drag.y - 1 }],
      })
      await command('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: drag.x, y: drag.to }],
      })
      try {
        await waitFor(
          `Number((${slider}).getAttribute('aria-valuenow'))>0&&Number((${slider}).getAttribute('aria-valuenow'))<Number((${slider}).getAttribute('aria-valuemax'))`,
          `${product}: touch drag did not move the slider`,
        )
      } catch (error) {
        await writeFile(
          join(output, `drag-${product}-${name}-events.json`),
          JSON.stringify(await evaluate('window.__historyGestureTrace'), null, 2),
        )
        throw error
      }
      const dragged = await visiblePreview(`${product}/${name}: touch preview absent`)
      const dragIndex = await evaluate(`Number((${slider}).getAttribute('aria-valuenow'))`)
      if (dragIndex <= 0 || dragIndex >= 31)
        throw Error(`${product}: touch gesture did not scrub to an interior record: ${dragIndex}`)
      await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await command('Emulation.setTouchEmulationEnabled', { enabled: false })
      const messageId = dragged.id.startsWith('[') ? JSON.parse(dragged.id)[2] : dragged.id
      await waitFor(
        `Boolean([...(${rail}).querySelectorAll('[data-archive-timeline-id][aria-current=true]')].find(el=>el.dataset.archiveTimelineId===${JSON.stringify(dragged.id)}))&&Boolean([...(${root}).querySelectorAll('[data-archive-message]')].find(el=>el.dataset.archiveMessage===${JSON.stringify(messageId)}))`,
        `${product}: drag preview and transcript disagree`,
      )
      await h.screenshot(`history-${product}-${name}`, width, height)
      const toggle = historyToggle
      await clickAt(toggle)
      await waitFor(`!(${rail})`, `${product}: history cannot be hidden`)
      const expanded = await evaluate(
        `(${surface}).querySelector('[data-archive-reading-transcript]').getBoundingClientRect().width`,
      )
      if (expanded < metrics.transcript.width + 79)
        throw Error(`${product}: hidden history did not return space to transcript`)
      await clickAt(toggle)
      await waitFor(`Boolean(${rail})`, `${product}: history cannot be restored`)
      reports.push({
        product,
        viewport: name,
        metrics,
        hovered: hovered.id,
        focused: focused.id,
        dragged: dragged.id,
        dragIndex,
        status: 'PASS',
      })
      await writeFile(join(output, 'history-ui.json'), JSON.stringify(reports, null, 2))
    }
    await open(product, 390, 844, 'empty')
    if (await evaluate(`Boolean(${rail})||Boolean(${historyToggle})`))
      throw Error(`${product}: empty history should not show a rail or action`)
  }
  await open('vk', 390, 844)
  await clickAt(button('Экспорт'))
  const dialog = `(${root}).querySelector('[role=dialog][aria-label="Экспорт сохранённых сообщений VK"]')`
  await waitFor(
    `Boolean((${dialog})?.querySelector('[data-archive-export-format-fields]'))`,
    'Shared export controls did not open',
  )
  for (const [format, packaging, extension] of [
    ['Markdown', 'Один файл', 'MD'],
    ['Текст', 'Один файл', 'TXT'],
    ['Markdown', 'ZIP', 'ZIP'],
  ]) {
    for (const [label, choice] of [
      ['Формат экспорта сообщений', format],
      ['Упаковка экспорта', packaging],
    ]) {
      const select = `([...(${dialog}).querySelectorAll('[role=combobox]')].find(el=>el.getAttribute('aria-label')===${JSON.stringify(label)}))`
      await clickAt(select)
      await clickAt(
        `([...(${root}).querySelectorAll('[role=option]')].find(el=>el.textContent.trim()===${JSON.stringify(choice)}))`,
      )
    }
    await clickAt(button('Подготовить экспорт', dialog))
    await waitFor(
      `Boolean([...(${dialog}).querySelectorAll('button')].find(el=>el.textContent.trim().startsWith('Скачать ${extension} ·')))`,
      `VK ${format}/${packaging} did not prepare the expected artifact`,
    )
    reports.push({ product: 'vk', format, packaging, extension, downloadClicked: false, status: 'PASS' })
  }
  await h.screenshot('history-vk-export-phone', 390, 844)
  await clickAt(button('Закрыть параметры', dialog))
  await writeFile(join(output, 'history-ui.json'), JSON.stringify(reports, null, 2))
  console.log(`HISTORY UI: ${reports.length} layout/interaction/export scenarios PASS`)
}
