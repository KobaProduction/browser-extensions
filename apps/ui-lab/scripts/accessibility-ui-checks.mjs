import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { browserScenario } from './browser-scenario.mjs'

/** Trusted keyboard input and the browser AX tree, using synthetic UI only. */
export async function checkAccessibilityUi(context) {
  const { command, evaluate, baseUrl, output } = context
  const h = browserScenario(context)
  const root =
    "[...document.querySelectorAll('*')].find(el=>el.shadowRoot?.querySelector('.booster-launcher,.booster-modal-surface,.booster-quick-menu'))?.shadowRoot"
  const reports = []
  const focused = () =>
    evaluate(
      `(() => {const r=${root},el=r?.activeElement;return {tag:el?.tagName,name:el?.getAttribute('aria-label'),insideQuick:!!el?.closest('.booster-quick-menu'),launcher:!!el?.matches('.booster-launcher'),quickOpen:!!r?.querySelector('.booster-quick-menu')};})()`,
    )
  const key = async (value, code) => {
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: value,
      code: value,
      windowsVirtualKeyCode: code,
      ...(value === 'Enter' ? { text: '\r' } : {}),
    })
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: value,
      code: value,
      windowsVirtualKeyCode: code,
    })
    await delay(80)
  }
  const closePanel = async () => {
    await h.clickAt(
      `(${root}).querySelector('button[aria-label="Закрыть окно"],button[aria-label="Close window"]')`,
    )
    await h.waitFor(`!(${root})?.querySelector('.booster-modal-surface')`, 'Panel did not close')
  }
  try {
    await h.navigate({ category: 'modules', width: 1365, height: 780 })
    await command('Page.bringToFront')
    await command('Emulation.setFocusEmulationEnabled', { enabled: true })
    const ax = await command('Accessibility.getFullAXTree')
    const controls = ax.nodes
      .filter((n) => !n.ignored && ['switch', 'slider'].includes(n.role?.value))
      .map((n) => ({ role: n.role.value, name: n.name?.value ?? '' }))
    reports.push({ name: 'module-control-names', controls })
    if (
      !controls.some((c) => c.role === 'slider') ||
      !controls.some((c) => c.role === 'switch') ||
      controls.some((c) => !c.name.trim())
    )
      throw Error(`Unnamed module controls: ${JSON.stringify(controls)}`)
    await h.screenshot('accessibility-module-controls', 1365, 780)
    await closePanel()
    await evaluate(`(${root}).querySelector('.booster-launcher').focus()`)
    await key('Enter', 13)
    await h.waitFor(
      `Boolean((${root})?.activeElement?.closest('.booster-quick-menu'))`,
      'Quick menu did not receive keyboard focus',
    )
    const opened = await focused()
    await key('Tab', 9)
    const tabbed = await focused()
    if (!tabbed.insideQuick)
      throw Error(`Tab escaped the first menu controls: ${JSON.stringify(tabbed)}`)
    await h.screenshot('accessibility-keyboard-menu', 1365, 780)
    await key('Escape', 27)
    await h.waitFor(
      `!(${root})?.querySelector('.booster-quick-menu')`,
      'Trusted Escape did not close menu',
    )
    const closed = await focused()
    if (!closed.launcher) throw Error('Escape did not restore launcher focus')
    reports.push({ name: 'menu-keyboard', opened, tabbed, closed })
    await key('Enter', 13)
    await h.waitFor(`Boolean((${root})?.querySelector('.booster-quick-menu'))`, 'Menu did not reopen')
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 10,
      y: 10,
      button: 'left',
      clickCount: 1,
    })
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 10,
      y: 10,
      button: 'left',
      clickCount: 1,
    })
    await h.waitFor(
      `!(${root})?.querySelector('.booster-quick-menu')`,
      'Outside pointer did not dismiss menu',
    )
    reports.push({ name: 'menu-outside-dismiss', status: 'pass' })

    // Synthetic host input: outside dismissal must preserve the first click and
    // immediate typing. An empty background click cannot detect stolen focus.
    await evaluate(
      `(() => {const input=document.createElement('input');input.id='host-focus-fixture';input.setAttribute('aria-label','Synthetic host composer');input.style.cssText='position:fixed;left:24px;top:24px;width:320px;height:40px;z-index:10';document.body.append(input)})()`,
    )
    await h.clickAt(`(${root}).querySelector('.booster-launcher')`)
    await h.waitFor(
      `Boolean((${root})?.querySelector('.booster-quick-menu'))`,
      'Menu did not reopen before host input',
    )
    await h.clickAt(`document.getElementById('host-focus-fixture')`)
    await command('Input.insertText', { text: 'FIRST_POINTER_INPUT_OK' })
    const firstInput = await evaluate(
      `(() => {const el=document.getElementById('host-focus-fixture');return {focused:document.activeElement===el,value:el.value,quickOpen:!!(${root})?.querySelector('.booster-quick-menu')}})()`,
    )
    if (!firstInput.focused || firstInput.value !== 'FIRST_POINTER_INPUT_OK' || firstInput.quickOpen)
      throw Error(`Outside dismissal stole the first input: ${JSON.stringify(firstInput)}`)
    reports.push({ name: 'menu-first-outside-input', ...firstInput, status: 'pass' })

    await h.clickAt(`(${root}).querySelector('.booster-launcher')`)
    await h.waitFor(
      `Boolean((${root})?.querySelector('.booster-quick-menu'))`,
      'Menu did not reopen before keyboard dismissal',
    )
    // The registry dialog loops Tab within its controls. Test an independent
    // host focus transfer, then trusted typing, without changing that contract.
    await evaluate(`document.getElementById('host-focus-fixture').focus()`)
    await command('Input.insertText', { text: '_KEYBOARD_OK' })
    const keyboardInput = await evaluate(
      `(() => {const el=document.getElementById('host-focus-fixture');return {focused:document.activeElement===el,value:el.value,quickOpen:!!(${root})?.querySelector('.booster-quick-menu')}})()`,
    )
    if (
      !keyboardInput.focused ||
      keyboardInput.value !== 'FIRST_POINTER_INPUT_OK_KEYBOARD_OK' ||
      keyboardInput.quickOpen
    )
      throw Error(`Outside host focus was stolen: ${JSON.stringify(keyboardInput)}`)
    reports.push({ name: 'menu-outside-focus-input', ...keyboardInput, status: 'pass' })

    await h.clickAt(`(${root}).querySelector('.booster-launcher')`)
    await h.waitFor(
      `Boolean((${root})?.querySelector('.booster-quick-menu'))`,
      'Menu did not reopen after outside dismissal',
    )
    await key('Escape', 27)
    const reopenedClosed = await focused()
    if (reopenedClosed.quickOpen || !reopenedClosed.launcher)
      throw Error('Outside dismissal leaked into the next Escape focus restoration')
    reports.push({ name: 'menu-reopened-escape-focus', status: 'pass' })
    await evaluate(`document.getElementById('host-focus-fixture').remove()`)

    for (const width of [390, 1365]) {
      for (const side of ['left', 'right']) {
        for (const dockRatio of [0.05, 0.95]) {
          await h.navigate({ view: 'quick', width, height: 844, side, dockRatio })
          const geometry = await evaluate(
            `(() => {const r=${root},menu=r.querySelector('.booster-quick-menu').getBoundingClientRect(),bar=r.querySelector('.booster-launcher').getBoundingClientRect(),up=r.querySelector('.booster-edge-toolkit').classList.contains('grow-up');return {menu:{left:menu.left,right:menu.right,top:menu.top,bottom:menu.bottom,width:menu.width},bar:{left:bar.left,right:bar.right,top:bar.top,bottom:bar.bottom,width:bar.width},up,gap:up?bar.top-menu.bottom:menu.top-bar.bottom}})()`,
          )
          if (
            geometry.up !== dockRatio > 0.5 ||
            Math.abs(geometry.menu.left - geometry.bar.left) > 1 ||
            Math.abs(geometry.menu.right - geometry.bar.right) > 1 ||
            Math.abs(geometry.gap) > 2 ||
            geometry.menu.left < -1 ||
            geometry.menu.right > width + 1 ||
            geometry.menu.top < -1 ||
            geometry.menu.bottom > 845
          )
            throw Error(`Disconnected menu ${width}/${side}/${dockRatio}: ${JSON.stringify(geometry)}`)
          reports.push({
            name: 'connected-menu-geometry',
            width,
            side,
            dockRatio,
            ...geometry,
            status: 'pass',
          })
          await h.screenshot(`connected-menu-${width}-${side}-${dockRatio}`, width, 844)
        }
      }
    }

    await h.navigate({ category: 'interface', width: 1063, height: 1173 })
    await h.clickAt(`(${root}).querySelector('[data-shell-settings] [role=combobox]')`)
    await h.clickAt(
      `([...(${root}).querySelectorAll('[role=option]')].find(el=>el.textContent.trim()==='English'))`,
    )
    await h.waitFor(
      `(${root}).querySelector('[data-shell-settings] h2')?.textContent==='Interface and display'`,
      'English preference did not apply',
    )
    for (const [label, selector] of [
      ['Backups', 'section[aria-label="Backups"]'],
      ['Telemetry and diagnostics', 'section[aria-label="Application telemetry"]'],
    ]) {
      await h.clickAt(h.button(label))
      await h.waitFor(
        `Boolean((${root}).querySelector(${JSON.stringify(selector)}))`,
        `English ${label} did not render`,
      )
      reports.push({ name: `english-${label.toLowerCase()}`, status: 'pass' })
    }
    await closePanel()
    await evaluate(`(${root}).querySelector('.booster-launcher').focus()`)
    await key('Enter', 13)
    await h.waitFor(
      `Boolean((${root})?.activeElement?.closest('.booster-quick-menu'))`,
      'English menu did not receive focus',
    )
    const menuText = await evaluate(`(${root}).querySelector('.booster-quick-menu')?.textContent`)
    if (!menuText?.includes('Settings') || /[А-Яа-яЁё]/.test(menuText))
      throw Error(`Untranslated English menu: ${menuText}`)
    reports.push({ name: 'english-menu', status: 'pass' })
    console.log(`ACCESSIBILITY UI: ${reports.length} keyboard/AX/language checks passed on ${baseUrl}`)
  } finally {
    await writeFile(join(output, 'accessibility-ui.json'), JSON.stringify(reports, null, 2))
  }
}
