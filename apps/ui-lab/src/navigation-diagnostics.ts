/** UI-lab checks distinguish Shell navigation from embedded provider navigation. */
export function findPlatformSettingsNav(root: ParentNode): Element | null {
  return root.querySelector(
    '.booster-modal-surface > .booster-control-center > .booster-settings-layout > .booster-settings-nav',
  )
}

export interface LayoutBox {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly width: number
}

export interface SettingsNavigationGeometry {
  readonly viewportWidth: number
  readonly columns: number
  readonly navigation: LayoutBox
  readonly content: LayoutBox
}

export function settingsNavigationWarnings({
  viewportWidth,
  columns,
  navigation,
  content,
}: SettingsNavigationGeometry): string[] {
  const warnings: string[] = []
  const mobile = viewportWidth <= 620
  if (columns !== (mobile ? 1 : 2))
    warnings.push('Settings grid has an unexpected responsive column count')
  for (const rect of [navigation, content]) {
    if (rect.width <= 0 || rect.bottom <= rect.top)
      warnings.push('Settings navigation or content has no visible area')
    if (rect.left < -2 || rect.right > viewportWidth + 2)
      warnings.push('Settings navigation or content overflows the viewport')
  }
  if (mobile) {
    // The product's <=620px media rule places full-width navigation above content.
    if (
      navigation.bottom > content.top + 2 ||
      Math.abs(navigation.left - content.left) > 2 ||
      Math.abs(navigation.right - content.right) > 2
    )
      warnings.push('Mobile settings navigation is not a separate full-width top row')
  } else {
    if (navigation.width > Math.max(250, viewportWidth * 0.5))
      warnings.push('Settings navigation occupies too much width')
    if (
      navigation.right > content.left + 2 ||
      navigation.bottom <= content.top ||
      content.bottom <= navigation.top
    )
      warnings.push('Settings sidebar and content overlap or lost their columns')
  }
  return [...new Set(warnings)]
}
