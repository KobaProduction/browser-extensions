/** Shared launcher geometry. Detaching preserves pointer movement; only nearby edges snap. */
export interface LauncherPoint {
  x: number
  y: number
}
export interface LauncherViewport {
  width: number
  height: number
}
export function clampLauncher(
  point: LauncherPoint,
  viewport: LauncherViewport,
  size = 44,
): LauncherPoint {
  return {
    x: Math.max(0, Math.min(point.x, viewport.width - size)),
    y: Math.max(0, Math.min(point.y, viewport.height - size)),
  }
}
export function dropLauncher(
  point: LauncherPoint,
  viewport: LauncherViewport,
  size = 44,
  threshold = 24,
) {
  const next = clampLauncher(point, viewport, size)
  const side =
    next.x <= threshold
      ? ('left' as const)
      : viewport.width - next.x - size <= threshold
        ? ('right' as const)
        : null
  return {
    ...next,
    x: side === 'left' ? 0 : side === 'right' ? Math.max(0, viewport.width - size) : next.x,
    side,
  }
}
/** Expanded content has its own clamped rectangle, independent of its anchor. */
export function launcherMenuGeometry(
  point: LauncherPoint,
  viewport: LauncherViewport,
  side: 'left' | 'right',
  size = 44,
  preferredWidth = 294,
) {
  const width = Math.min(preferredWidth, Math.max(0, viewport.width))
  const left = Math.max(
    0,
    Math.min(side === 'right' ? point.x + size - width : point.x, viewport.width - width),
  )
  const growsUp = point.y > Math.max(0, viewport.height - size) / 2
  return {
    width,
    offsetX: left - point.x,
    growsUp,
    contentHeight: Math.max(0, growsUp ? point.y : viewport.height - point.y - size),
  }
}
