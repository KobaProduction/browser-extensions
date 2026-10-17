import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { browserScenario } from './browser-scenario.mjs'

/** Real wheel input on deterministic local archives; no provider calls or private data. */
export async function checkReaderScrollUi(context) {
  const { command, evaluate, output } = context
  const h = browserScenario(context)
  const { root, waitFor, clickAt } = h
  const viewport = `(${root}).querySelector('.vk-reader-transcript,.booster-reader-scroll')`
  const edge = (name) => `(${root}).querySelector('[data-archive-reader-edge="${name}"]')`
  const stateCode = `(() => {const v=${viewport},ids=[...v.querySelectorAll('[data-archive-message]')].map(e=>{const id=e.dataset.archiveMessage;return id.startsWith('demo-msg-')?Number(id.slice(9)):Number(id)-1000});return {ids,first:Math.min(...ids),last:Math.max(...ids),count:ids.length,top:v.scrollTop,height:v.scrollHeight,viewportHeight:v.clientHeight}})()`
  const state = () => evaluate(stateCode)
  const reports = []
  async function scrollStep(direction) {
    const before = await state()
    await evaluate(
      `(() => {const v=${viewport};v.scrollTop=${direction === 'newer' ? 'v.scrollHeight-v.clientHeight-80' : '80'}})()`,
    )
    await delay(80)
    const ready = await state()
    if (ready.first !== before.first || ready.last !== before.last)
      throw Error('Programmatic positioning triggered an unsolicited archive read')
    const anchor = await evaluate(
      `(() => {const v=${viewport},b=v.getBoundingClientRect(),n=[...v.querySelectorAll('[data-archive-node]')].find(e=>{const r=e.getBoundingClientRect();return r.bottom>b.top&&r.top<b.bottom});return {id:n?.dataset.archiveNode,offset:n? n.getBoundingClientRect().top-b.top:null,x:b.x+b.width/2,y:b.y+b.height/2}})()`,
    )
    const delta = direction === 'newer' ? 20 : -20
    await command('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: anchor.x,
      y: anchor.y,
      deltaX: 0,
      deltaY: delta,
    })
    await waitFor(
      `(() => {const s=${stateCode};return ${direction === 'newer' ? `s.last>${before.last}` : `s.first<${before.first}`}})()`,
      `User scroll did not load ${direction} records`,
    )
    await delay(100)
    const after = await state()
    const offset = await evaluate(
      `(() => {const v=${viewport},n=[...v.querySelectorAll('[data-archive-node]')].find(e=>e.dataset.archiveNode===${JSON.stringify(anchor.id)});return n?n.getBoundingClientRect().top-v.getBoundingClientRect().top:null})()`,
    )
    if (
      after.count > 320 ||
      new Set(after.ids).size !== after.count ||
      offset === null ||
      Math.abs(offset - anchor.offset + delta) > 4
    )
      throw Error(
        `Adjacent records/anchor differ: ${JSON.stringify({ before, after, anchor, offset, delta })}`,
      )
    return after
  }
  for (const product of ['vk', 'all-in-one-vk', 'chatgpt', 'all-in-one']) {
    for (const width of [1365, 390]) {
      const height = 900
      await h.navigate({ product, width, height, scene: 'long', view: 'archive' })
      await waitFor(
        `Boolean(${edge('first')})&&Boolean(${viewport})&&(${viewport}).clientHeight>100`,
        'Reader navigation/viewport absent',
      )
      await clickAt(edge('first'))
      await waitFor(`(${stateCode}).first===1`, 'First boundary did not open the archive start')
      let current = await state()
      const seen = new Set(current.ids)
      let steps = 0
      const walkAll = product === 'vk' && width === 1365
      while (current.last < 3000 && (walkAll || steps < 5)) {
        current = await scrollStep('newer')
        for (const id of current.ids) seen.add(id)
        steps++
        if (steps > 50) throw Error('Archive scrolling stalled before reaching its end')
      }
      if (walkAll && (seen.size !== 3000 || current.last !== 3000))
        throw Error('Seamless traversal skipped saved records')
      await clickAt(edge('last'))
      await waitFor(`(${stateCode}).last===3000`, 'Last boundary did not open the archive end')
      for (let i = 0; i < 3; i++) current = await scrollStep('older')
      await h.screenshot(`reader-scroll-${product}-${width}`, width, height)
      reports.push({
        product,
        width,
        steps,
        seen: seen.size,
        loaded: current.count,
        first: current.first,
        last: current.last,
        status: 'pass',
      })
    }
  }
  await writeFile(
    join(output, 'reader-scroll-ui.json'),
    JSON.stringify({ status: 'pass', scope: 'synthetic-local-only', reports }, null, 2),
  )
  console.log(
    'Reader scroll UI: 8 cases passed; shared navigation, adjacent loading, anchors and complete 3000-record traversal',
  )
}
