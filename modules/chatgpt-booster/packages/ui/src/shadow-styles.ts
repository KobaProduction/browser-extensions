import { attachPortalTopLayer } from '@kobaproduction/browser-ui'
import styles from './styles.css?inline'

let sharedSheet: CSSStyleSheet | undefined
let constructedSheetsUnavailable = false

function boosterStyleSheet(): CSSStyleSheet | undefined {
  if (constructedSheetsUnavailable) return undefined
  if (sharedSheet) return sharedSheet
  if (typeof CSSStyleSheet !== 'function' || typeof CSSStyleSheet.prototype.replaceSync !== 'function') {
    constructedSheetsUnavailable = true
    return undefined
  }
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(styles)
    sharedSheet = sheet
    return sheet
  } catch {
    constructedSheetsUnavailable = true
    return undefined
  }
}

export function installBoosterShadowStyles(shadow: ShadowRoot) {
  const sheet = boosterStyleSheet()
  if (sheet && 'adoptedStyleSheets' in shadow) {
    if (!shadow.adoptedStyleSheets.includes(sheet))
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet]
    return
  }

  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)
}

/** Every native injection uses the same style boundary and portal layer. */
export function createBoosterShadowSurface(host: HTMLElement, tag: 'div' | 'span' = 'span') {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
  installBoosterShadowStyles(shadow)
  const mountPoint = document.createElement(tag)
  const portal = document.createElement('div')
  portal.style.cssText =
    'position:fixed;inset:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:auto'
  shadow.append(mountPoint, portal)
  const dispose = attachPortalTopLayer(portal)
  return { shadow, mountPoint, portal, dispose }
}
