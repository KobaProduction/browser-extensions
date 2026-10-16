import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** CDP interactions with public synthetic UI only; never inspect private Vue/runtime state. */
export function browserScenario({ command, evaluate, baseUrl, output }) {
  const root =
    "[...document.querySelectorAll('*')].find(el => el.shadowRoot?.querySelector('.booster-modal-surface,.booster-quick-menu,.booster-launcher'))?.shadowRoot"
  async function waitFor(expression, message, timeout = 7000) {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      if (await evaluate(expression)) return
      await delay(75)
    }
    throw Error(message)
  }
  const button = (text, scope = root) =>
    `([...(${scope})?.querySelectorAll('button')||[]].find(el => el.textContent?.trim() === ${JSON.stringify(text)}))`
  const labelled = (text) =>
    `(() => { const r=${root}; const label=[...r.querySelectorAll('label')].find(el=>el.textContent?.trim()===${JSON.stringify(text)}); return r.getElementById(label?.getAttribute('for')) })()`
  async function setValue(expression, value, commit = false) {
    await evaluate(
      `(() => { const input=${expression}; if(!input)throw Error('Field missing'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input',{bubbles:true,composed:true})); ${commit ? "input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));" : ''} })()`,
    )
  }
  async function click(text, scope = root) {
    await waitFor(
      `(() => {const el=${button(text, scope)};if(!el||el.disabled)return false;const rect=el.getBoundingClientRect();return rect.width>0&&rect.height>0})()`,
      `Button did not become available: ${text}`,
    )
    await evaluate(
      `(() => { const el=${button(text, scope)}; if(!el||el.disabled)throw Error('Button unavailable: '+${JSON.stringify(text)}); const rect=el.getBoundingClientRect(); if(rect.width<=0||rect.height<=0)throw Error('Button hidden: '+${JSON.stringify(text)}); el.click() })()`,
    )
    await delay(70)
  }
  async function clickAt(expression) {
    await waitFor(
      `(() => {const el=${expression};if(!el||el.disabled)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0})()`,
      'Pointer target did not become visible and enabled',
    )
    await evaluate(
      `(${expression}).scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})`,
    )
    let point
    let previous
    let diagnostic
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) {
      diagnostic = await evaluate(
        `(() => {const el=${expression};if(!el)return {ready:false,reason:'missing'};const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=el.getRootNode().elementFromPoint(x,y);return {x,y,ready:!el.disabled&&r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight&&getComputedStyle(el).pointerEvents!=='none'&&(hit===el||el.contains(hit)),target:el.tagName,hit:hit?.tagName,hitRole:hit?.getAttribute('role'),bodyPointerEvents:getComputedStyle(document.body).pointerEvents}})()`,
      )
      if (
        diagnostic.ready &&
        previous?.ready &&
        Math.abs(diagnostic.x - previous.x) < 0.5 &&
        Math.abs(diagnostic.y - previous.y) < 0.5
      ) {
        point = { x: diagnostic.x, y: diagnostic.y }
        break
      }
      previous = diagnostic
      await delay(50)
    }
    if (!point)
      throw Error(
        `Pointer target did not settle or remained covered: ${expression.slice(0, 300)}; ${JSON.stringify(diagnostic)}`,
      )
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      ...point,
    })
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
      ...point,
    })
  }
  async function navigate({
    category,
    width = 1440,
    height = 960,
    product = 'chatgpt',
    scene = 'saved',
    view = 'settings',
    ...extra
  }) {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    })
    const params = new URLSearchParams({
      product,
      scene,
      view,
      task: view === 'archive' ? 'archive' : 'interface',
      method: 'chromium',
      side: 'right',
      dockReset: '1',
      ...extra,
    })
    if (category)
      params.set(
        'shellCategory',
        category.includes(':') || category === 'interface'
          ? category
          : `provider:chatgpt-booster:${category}`,
      )
    const url = `${baseUrl}/preview.html?${params}`
    const navigation = await command('Page.navigate', { url })
    if (navigation.errorText) throw Error(`Preview navigation failed: ${navigation.errorText}`)
    if (navigation.loaderId) {
      const until = Date.now() + 7000
      let committed = false
      while (Date.now() < until) {
        const { frameTree } = await command('Page.getFrameTree')
        if (frameTree.frame.loaderId === navigation.loaderId) {
          committed = true
          break
        }
        await delay(30)
      }
      if (!committed) throw Error('Preview document did not commit')
    }
    const ready =
      view === 'quick'
        ? `Boolean((${root})?.querySelector('.booster-quick-menu'))`
        : category && !category.includes(':') && category !== 'interface'
          ? `Boolean((${root})?.querySelector('[data-settings-section=${JSON.stringify(category)}]'))`
          : `Boolean((${root})?.querySelector('.booster-modal-surface'))`
    await waitFor(
      `location.href===${JSON.stringify(url)}&&document.readyState!=='loading'&&(${ready})`,
      `Preview did not mount: ${product}/${category ?? view}`,
    )
    // Wait beyond registry enter animation and the resize reconciliation frame.
    await delay(300)
  }
  async function screenshot(name, width, height) {
    const png = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const bytes = Buffer.from(png.data, 'base64')
    if (bytes.length < 24 || bytes.toString('ascii', 1, 4) !== 'PNG') throw Error(`Invalid PNG: ${name}`)
    const actual = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
    if (actual[0] !== width || actual[1] !== height)
      throw Error(`Screenshot size mismatch: ${name} (${actual} != ${width},${height})`)
    await writeFile(join(output, `${name}.png`), bytes)
    return actual
  }
  async function geometry(name, width, height, scope = '[data-settings-section]') {
    const result = await evaluate(
      `(() => { const r=${root}; const panel=r.querySelector('.booster-modal-surface'),p=panel.getBoundingClientRect(); const section=r.querySelector(${JSON.stringify(scope)}); if(!section)throw Error('Scenario surface missing'); const visible=el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0}; const controls=[...section.querySelectorAll('input,textarea,[role=combobox],[role=switch],[role=checkbox]')].filter(visible); const overflow=controls.filter(el=>{const b=el.getBoundingClientRect();return b.x<p.x-1||b.right>p.right+1}).map(el=>el.tagName); const unlabelled=controls.filter(el=>{if(el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||el.closest('label')?.control===el)return false;return !el.id||![...r.querySelectorAll('label')].some(label=>label.htmlFor===el.id)}).map(el=>el.tagName); return {panel:{x:p.x,y:p.y,width:p.width,height:p.height},overflow,unlabelled,panelPainted:panel.contains(r.elementFromPoint(innerWidth/2,Math.min(150,innerHeight/2))),warnings:window.__uiLabPreviewReport?.warnings||[]}; })()`,
    )
    if (
      !result.panelPainted ||
      result.overflow.length ||
      result.unlabelled.length ||
      result.warnings.some((warning) => /Unhandled rejection|Browser exception/.test(warning))
    )
      throw Error(`${name}: ${JSON.stringify(result)}`)
    const p = result.panel
    if (p.x < -1 || p.y < -1 || p.x + p.width > width + 1 || p.y + p.height > height + 1)
      throw Error(`${name}: dialog outside viewport`)
    if (width <= 620 && (p.x !== 0 || p.y !== 0 || p.width !== width || p.height !== height))
      throw Error(`${name}: fullscreen bounds differ`)
    await screenshot(name, width, height)
    return { name, width, height, ...result }
  }
  return { root, waitFor, button, labelled, setValue, click, clickAt, navigate, screenshot, geometry }
}
