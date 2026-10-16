/** Viewport-proportional docking primitives shared by archive and tool workspaces. */
export interface Viewport {
  width: number
  height: number
}
export interface WorkspaceRect {
  x: number
  y: number
  width: number
  height: number
}
export interface WorkspaceRatios {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
}
export interface WorkspaceDockRatios {
  minimizedSide: 'left' | 'right'
  minimizedHeightRatio: number
}
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
export function workspaceRect(value: WorkspaceRatios, viewport: Viewport): WorkspaceRect {
  const finite = (ratio: number, fallback: number) => (Number.isFinite(ratio) ? ratio : fallback)
  const viewportWidth = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0
  const viewportHeight = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0
  const insetX = Math.min(8, viewportWidth / 2),
    insetY = Math.min(8, viewportHeight / 2)
  const maxWidth = Math.max(0, viewportWidth - insetX * 2)
  const maxHeight = Math.max(0, viewportHeight - insetY * 2)
  // A preferred minimum must never become larger than the available viewport.
  // This same rectangle is used for rendering, pointer motion and persistence.
  const width = clamp(viewportWidth * finite(value.widthRatio, 0.72), Math.min(560, maxWidth), maxWidth)
  const height = clamp(
    viewportHeight * finite(value.heightRatio, 0.82),
    Math.min(420, maxHeight),
    maxHeight,
  )
  return {
    x: clamp(
      viewportWidth * finite(value.xRatio, 0.08),
      insetX,
      Math.max(insetX, viewportWidth - width - insetX),
    ),
    y: clamp(
      viewportHeight * finite(value.yRatio, 0.08),
      insetY,
      Math.max(insetY, viewportHeight - height - insetY),
    ),
    width,
    height,
  }
}
export function workspaceRatios(value: WorkspaceRect, viewport: Viewport): WorkspaceRatios {
  return {
    xRatio: value.x / Math.max(1, viewport.width),
    yRatio: value.y / Math.max(1, viewport.height),
    widthRatio: value.width / Math.max(1, viewport.width),
    heightRatio: value.height / Math.max(1, viewport.height),
  }
}
export function dockedIconStyle(
  value: WorkspaceDockRatios | undefined,
  viewport: Viewport,
): { left: string; top: string } {
  const side = value?.minimizedSide ?? 'right'
  const y = (viewport.height - 42) * (value?.minimizedHeightRatio ?? 0.45)
  return {
    left: side === 'left' ? '0px' : `${Math.max(0, viewport.width - 42)}px`,
    top: `${clamp(y, 0, Math.max(0, viewport.height - 42))}px`,
  }
}
export function dockedIconRatios(x: number, y: number, viewport: Viewport): WorkspaceDockRatios {
  return {
    minimizedSide: x + 21 < viewport.width / 2 ? 'left' : 'right',
    minimizedHeightRatio: clamp(y / Math.max(1, viewport.height - 42), 0, 1),
  }
}
