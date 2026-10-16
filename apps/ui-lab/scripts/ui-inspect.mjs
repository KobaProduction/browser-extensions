/** Short diagnostic replay, always inside the runner's disposable browser profile. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function inspectUi({ command, evaluate, baseUrl, output }) {
  const reports = []
  const failures = []
  for (const [name, width, height, view, category, product = 'chatgpt'] of [
    ['desktop-interface', 1440, 960, 'settings', 'interface'],
    ['desktop-remote', 1440, 960, 'settings', 'provider:chatgpt-booster:remote'],
    ['mobile-settings', 390, 844, 'settings', 'interface'],
    ['mobile-sounds', 390, 844, 'settings', 'provider:chatgpt-booster:sounds'],
    ['mobile-triggers', 390, 844, 'settings', 'provider:chatgpt-booster:triggers'],
    ['mobile-remote', 390, 844, 'settings', 'provider:chatgpt-booster:remote'],
    ['mobile-quick', 390, 844, 'quick', 'interface'],
    ['mobile-launcher-tap', 390, 844, 'closed', 'interface'],
    ['tablet-settings', 820, 1180, 'settings', 'interface'],
    ['vk-quick-settings', 1365, 780, 'quick', 'interface', 'vk'],
  ]) {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    const query = new URLSearchParams({
      product,
      scene: 'saved',
      view,
      task: 'interface',
      shellCategory: category,
      method: 'chromium',
      side: 'right',
      dockReset: '1',
    })
    await command('Page.navigate', { url: `${baseUrl}/preview.html?${query}` })
    const deadline = Date.now() + 15000
    let ready = false
    while (Date.now() < deadline) {
      ready = await evaluate('Boolean(window.__uiLabPreviewReport?.shell)')
      if (ready) break
      await delay(100)
    }
    if (!ready) throw Error(`UI did not mount: ${name}`)
    await delay(250)
    if (name === 'mobile-launcher-tap') {
      await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      const tap = async (selector) => {
        const point = await evaluate(
          `(() => { const root = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.querySelector('.booster-launcher,.booster-quick-menu'))?.shadowRoot; const element = root?.querySelector(${JSON.stringify(selector)}); if (!element) throw Error('Tap control missing'); const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2} })()`,
        )
        await command('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...point, id: 1 }],
        })
        await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await delay(180)
      }
      await tap('.booster-launcher')
      await tap('[data-quick-action="settings"]')
      await command('Emulation.setTouchEmulationEnabled', { enabled: false })
      await delay(250)
    }
    if (name === 'vk-quick-settings') {
      await evaluate(
        `(() => { const root = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.querySelector('.booster-quick-menu'))?.shadowRoot; [...(root?.querySelectorAll('.booster-quick-actions button')||[])].find(el => el.textContent?.includes('Настройки'))?.click() })()`,
      )
      await delay(300)
    }
    let checkboxInteraction
    if (name === 'desktop-remote') {
      checkboxInteraction = await evaluate(`(async () => {
        const root = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.querySelector('.booster-modal-surface'))?.shadowRoot;
        const group = [...(root?.querySelectorAll('button') || [])].find(el => el.textContent?.includes('Управление диалогом'));
        group?.click(); await new Promise(resolve => setTimeout(resolve, 80));
        const checkbox = root?.querySelector('[role=checkbox]');
        if (!checkbox) return {found:false};
        const before = checkbox.getAttribute('aria-checked'); checkbox.click();
        await new Promise(resolve => setTimeout(resolve, 80));
        const after = checkbox.getAttribute('aria-checked'), style = getComputedStyle(checkbox);
        return {found:true,before,after,border:style.border,icon: Boolean(checkbox.querySelector('svg')),width:checkbox.getBoundingClientRect().width};
      })()`)
      if (
        !checkboxInteraction.found ||
        checkboxInteraction.before === checkboxInteraction.after ||
        !checkboxInteraction.icon ||
        !checkboxInteraction.border.startsWith('1px solid') ||
        checkboxInteraction.width < 16
      )
        failures.push('desktop-remote: Checkbox state or visible checkmark failed')
    }
    const measured = await evaluate(`(() => {
      const root = [...document.querySelectorAll('*')].find(el => el.shadowRoot?.querySelector('.booster-modal-surface,.booster-quick-menu,.booster-launcher'))?.shadowRoot;
      const read = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return {tag:el.tagName, role:el.getAttribute('role'), text:(el.textContent||'').trim().slice(0,60), class:el.className, border:s.border, background:s.backgroundColor, color:s.color, font:s.fontSize, rect:{x:r.x,y:r.y,width:r.width,height:r.height}} };
      const panel = root?.querySelector('.booster-modal-surface');
      const painted = panel ? root.elementFromPoint(innerWidth / 2, 150) : null;
      return {report:window.__uiLabPreviewReport, panelPainted: !panel || Boolean(painted && panel.contains(painted)), surfaces: root ? [...root.querySelectorAll('.booster-modal-surface,.booster-control-center,.booster-shell-settings')].map(read) : [], controls: root ? [...root.querySelectorAll('[role=checkbox],[role=switch],input,.rounded-xl')].slice(0,30).map(read) : []};
    })()`)
    const png = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(output, `inspect-${name}.png`), Buffer.from(png.data, 'base64'))
    reports.push({ name, width, height, checkboxInteraction, ...measured })
    const surface = measured.surfaces.find((item) => item.role === 'dialog')
    if (surface) {
      const rect = surface.rect
      if (
        rect.x < -1 ||
        rect.y < -1 ||
        rect.x + rect.width > width + 1 ||
        rect.y + rect.height > height + 1
      )
        failures.push(`${name}: dialog outside viewport`)
      if (
        width <= 620 &&
        (rect.x !== 0 || rect.y !== 0 || rect.width !== width || rect.height !== height)
      )
        failures.push(`${name}: mobile dialog is not fullscreen`)
      if (width <= 620 && !measured.panelPainted) failures.push(`${name}: fullscreen panel obscured`)
    }
    if (
      measured.controls.some(
        (item) => item.class.includes('rounded-xl') && !item.border.startsWith('1px solid'),
      )
    )
      failures.push(`${name}: missing Card border`)
    if (measured.report.warnings.some((issue) => /Unhandled rejection|Browser exception/.test(issue)))
      failures.push(`${name}: browser runtime exception`)
  }
  await writeFile(join(output, 'inspect-ui.json'), JSON.stringify(reports, null, 2))
  if (failures.length) throw Error(failures.join('; '))
  console.log('UI diagnostic screenshots and computed control styles saved to', output)
}
