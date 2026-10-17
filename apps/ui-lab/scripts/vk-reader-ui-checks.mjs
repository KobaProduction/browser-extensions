import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { browserScenario } from './browser-scenario.mjs'

/** Generated local records only; file controls are inspected without downloading fixtures. */
export async function checkVkReaderUi(context) {
  const { command, evaluate, output } = context
  const h = browserScenario(context)
  const { root, waitFor, button, clickAt } = h
  const reports = []
  for (const product of ['vk', 'all-in-one-vk']) {
    for (const [width, height] of [
      [1365, 900],
      [390, 844],
    ]) {
      const name = `vk-reader-${product}-${width}`
      await h.navigate({ product, width, height, scene: 'saved', view: 'archive' })
      await waitFor(
        `Boolean((${root})?.querySelector('[data-archive-message="1003"]'))`,
        'Saved wall fixture missing',
      )
      await waitFor(
        `Boolean((${root})?.querySelector('[data-archive-message] .booster-message-target'))`,
        'Active message surface missing',
      )
      const reader = await evaluate(`(() => {
        const r=${root},card=r.querySelector('[data-archive-message] .booster-message-target'),row=card.closest('[data-archive-message]');
        const post=r.querySelector('[data-archive-message="1003"]'),wall=post.querySelector('[data-asset-type="wall"]');
        return {cardTarget:!!card,rowTarget:row.classList.contains('booster-message-target'),rowWidth:row.getBoundingClientRect().width,cardWidth:card?.getBoundingClientRect().width,
          wallDownload:[...wall.querySelectorAll('button')].some(e=>e.textContent.includes('Загрузить оригинал')),
          wallLink:wall.querySelector('a')?.getAttribute('href'),nestedPhoto:!!post.querySelector('[data-asset-type="photo"] button')};
      })()`)
      if (
        !reader.cardTarget ||
        reader.rowTarget ||
        reader.cardWidth >= reader.rowWidth ||
        reader.wallDownload ||
        reader.wallLink !== 'https://vk.ru/wall-42_23' ||
        !reader.nestedPhoto
      )
        throw Error(`Reader original/highlight regression: ${JSON.stringify(reader)}`)
      const readerSpacing = `(() => {
        const r=${root},panel=r.querySelector('[data-provider-view=reader]'),toolbar=panel.querySelector('[role=toolbar]'),buttons=[...toolbar.querySelectorAll('button')],messages=[...panel.querySelectorAll('[data-archive-message] article')],summary=panel.querySelector('[data-vk-reader-summary]').getBoundingClientRect(),bounds=panel.getBoundingClientRect();
        return {gaps:messages.slice(1).map((m,i)=>m.getBoundingClientRect().top-messages[i].getBoundingClientRect().bottom),padding:parseFloat(getComputedStyle(panel).paddingLeft),dividerInsets:[summary.left-bounds.left,bounds.right-summary.right],buttonHeights:buttons.map(b=>b.getBoundingClientRect().height),toolbarInset:buttons[0].getBoundingClientRect().left-bounds.left};
      })()`
      function assertSpacing(spacing) {
        if (
          !spacing.gaps.length ||
          spacing.gaps.some((gap) => gap < 8 || gap > 16) ||
          spacing.padding !== 0 ||
          spacing.dividerInsets.some((inset) => Math.abs(inset) > 1) ||
          spacing.toolbarInset < 6 ||
          Math.max(...spacing.buttonHeights) - Math.min(...spacing.buttonHeights) > 1
        )
          throw Error(`Reader messages/actions touch or differ in size: ${JSON.stringify(spacing)}`)
      }
      const spacing = await evaluate(readerSpacing)
      assertSpacing(spacing)
      const point = `(${root}).querySelector('[data-archive-timeline-id="1001"]')`
      await waitFor(
        `(${point})?.getAttribute('aria-label')?.includes('Алексей Иванов')`,
        'Timeline ignored the verified participant name',
      )
      const hover = await evaluate(
        `(() => {const b=(${point}).getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`,
      )
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hover })
      const preview = `(${root}).querySelector('[data-archive-timeline-preview-id="1001"][data-state$="open"]')`
      await waitFor(`Boolean(${preview})`, 'Timeline hover preview absent')
      await waitFor(
        `(${preview})?.getAnimations().every(animation=>animation.playState!=='running')`,
        'Timeline preview did not finish painting',
      )
      const timeline = await evaluate(`(() => {
        const r=${root},p=${preview},b=p.getBoundingClientRect(),s=getComputedStyle(p),time=p.querySelector('[data-archive-timeline-sent-at]');
        return {author:p.querySelector('[data-archive-timeline-author]')?.textContent.trim(),message:p.querySelector('[data-archive-timeline-text]')?.textContent.trim(),dateTime:time?.getAttribute('datetime'),date:time?.textContent.trim(),railDate:r.querySelector('[data-archive-timeline-date]')?.textContent.trim(),position:p.textContent.includes('1 / 32'),technicalId:/#1001\\b/.test(p.textContent),width:b.width,height:b.height,x:b.x,right:b.right,y:b.y,bottom:b.bottom,foreground:s.color,background:s.backgroundColor,scrollWidth:p.scrollWidth,clientWidth:p.clientWidth};
      })()`)
      if (
        timeline.author !== 'Алексей Иванов' ||
        !timeline.message ||
        timeline.dateTime !== '2025-10-09T08:53:20.000Z' ||
        !timeline.date ||
        !timeline.railDate ||
        !timeline.position ||
        timeline.technicalId ||
        timeline.width < 200 ||
        timeline.x < 0 ||
        timeline.right > width + 1 ||
        timeline.y < 0 ||
        timeline.bottom > height + 1 ||
        timeline.scrollWidth > timeline.clientWidth + 1 ||
        timeline.foreground === timeline.background
      )
        throw Error(`Timeline content/layout regression: ${JSON.stringify(timeline)}`)
      await h.screenshot(`${name}-timeline`, width, height)
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
      await clickAt(button('Выбор сообщений'))
      const selectionSpacing = await evaluate(readerSpacing)
      assertSpacing(selectionSpacing)
      await clickAt(`(${root}).querySelector('[data-archive-message="1001"] [role=checkbox]')`)
      await waitFor(
        `(${root}).querySelector('[data-archive-message="1001"] [role=checkbox]')?.getAttribute('aria-checked')==='true'`,
        'Export checkbox did not select its message',
      )
      const selectionLayout = await evaluate(
        `(() => {const row=(${root}).querySelector('[data-archive-message="1001"]'),box=row.querySelector('[role=checkbox]').getBoundingClientRect(),message=row.querySelector('article').getBoundingClientRect();return {display:getComputedStyle(row).display,gap:message.left-box.right,topOffset:Math.abs(message.top-box.top)}})()`,
      )
      if (
        selectionLayout.display !== 'grid' ||
        selectionLayout.gap < 8 ||
        selectionLayout.gap > 12 ||
        selectionLayout.topOffset > 16
      )
        throw Error(`Checkbox is not aligned beside its message: ${JSON.stringify(selectionLayout)}`)
      await h.screenshot(`${name}-selection`, width, height)
      const geometry = await h.geometry(name, width, height, '[data-provider-view=reader]')

      await h.navigate({
        product,
        width,
        height,
        scene: 'saved',
        category: 'provider:vk-booster:capture',
      })
      await waitFor(
        `Boolean((${root})?.querySelector('[data-provider-view=capture]'))`,
        'Capture fixture missing',
      )
      await clickAt(button('Собрать всю историю'))
      await waitFor(
        `(${root}).textContent.includes('Вся доступная история сохранена.')`,
        'First synthetic scan did not complete',
      )
      await clickAt(button('Собрать всю историю'))
      await waitFor(
        String.raw`/Прочитано из VK:\s*3\D/.test((${root}).textContent)&&/Уже проверенный хвост:\s*29\D/.test((${root}).textContent)`,
        'Repeated scan did not separate source reads and reused coverage',
      )
      const progress = await evaluate(
        `(() => {const r=${root},control=r.querySelector('.booster-conversation-collection'),bar=control.querySelector('[role=progressbar]');return {value:bar.getAttribute('aria-valuenow'),counter:control.textContent.includes('32 / 32'),gap:getComputedStyle(control).rowGap}})()`,
      )
      if (progress.value !== '100' || !progress.counter || parseFloat(progress.gap) < 8)
        throw Error(`Completed reused-history progress differs: ${JSON.stringify(progress)}`)
      await waitFor(
        `(() => {const bar=(${root}).querySelector('.booster-conversation-collection [role=progressbar]');return Math.abs(new DOMMatrixReadOnly(getComputedStyle(bar.firstElementChild).transform).m41)<1})()`,
        'Completed progress did not finish painting',
      )
      await h.screenshot(`${name}-progress`, width, height)
      reports.push({
        product,
        width,
        height,
        reader,
        timeline,
        spacing,
        selectionSpacing,
        selectionLayout,
        progress,
        geometry,
      })
    }
  }
  await writeFile(
    join(output, 'vk-reader-ui.json'),
    JSON.stringify({ status: 'pass', scope: 'synthetic-local-only', reports }, null, 2),
  )
  console.log(
    'VK Reader UI: 4 responsive cases passed: dated named timeline previews, nested originals, message-card target, export checkbox and reused-history progress',
  )
}
