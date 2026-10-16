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
  if (columns !== 1) warnings.push('Settings grid has an unexpected responsive column count')
  for (const rect of [navigation, content]) {
    if (rect.width <= 0 || rect.bottom <= rect.top)
      warnings.push('Settings navigation or content has no visible area')
    if (rect.left < -2 || rect.right > viewportWidth + 2)
      warnings.push('Settings navigation or content overflows the viewport')
  }
  // One shared catalog sits above the single content column at every viewport.
  if (
    navigation.bottom > content.top + 2 ||
    content.left < navigation.left - 2 ||
    content.right > navigation.right + 2 ||
    Math.abs(navigation.left - content.left) > 24 ||
    Math.abs(navigation.right - content.right) > 24
  )
    warnings.push('Settings catalog is not a separate full-width top row')
  return [...new Set(warnings)]
}
