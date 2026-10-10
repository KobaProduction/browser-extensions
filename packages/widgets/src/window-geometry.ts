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
  const minWidth = Math.min(560, Math.max(320, viewport.width - 24))
  const minHeight = Math.min(420, Math.max(280, viewport.height - 24))
  const width = clamp(
    viewport.width * value.widthRatio,
    minWidth,
    Math.max(minWidth, viewport.width - 24),
  )
  const height = clamp(
    viewport.height * value.heightRatio,
    minHeight,
    Math.max(minHeight, viewport.height - 24),
  )
  return {
    x: clamp(viewport.width * value.xRatio, 8, Math.max(8, viewport.width - width - 8)),
    y: clamp(viewport.height * value.yRatio, 8, Math.max(8, viewport.height - height - 8)),
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
