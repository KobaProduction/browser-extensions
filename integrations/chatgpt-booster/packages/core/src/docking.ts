export type DockSide = 'left' | 'right'
export function clampRatio(value: unknown, fallback = 0.65): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}
export function dockPosition(
  side: DockSide,
  ratio: number,
  width: number,
  height: number,
  size = 44,
) {
  return {
    x: side === 'left' ? 0 : Math.max(0, width - size),
    y: Math.max(0, height - size) * clampRatio(ratio),
  }
}
export function dockFromDrop(x: number, y: number, width: number, height: number, size = 44) {
  return {
    side: (x + size / 2 < width / 2 ? 'left' : 'right') as DockSide,
    heightRatio: clampRatio(y / Math.max(1, height - size)),
  }
}
