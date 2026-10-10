import styles from './styles.css?inline'

let sharedSheet: CSSStyleSheet | undefined
let constructedSheetsUnavailable = false

function boosterStyleSheet(): CSSStyleSheet | undefined {
  if (constructedSheetsUnavailable) return undefined
  if (sharedSheet) return sharedSheet
  if (
    typeof CSSStyleSheet !== 'function' ||
    typeof CSSStyleSheet.prototype.replaceSync !== 'function'
  ) {
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
