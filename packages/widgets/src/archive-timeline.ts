export interface ArchiveTimelineNode {
  id: string
  parentId: string | null
  label: string
  preview?: string
  uncertain?: boolean
}
export interface ArchiveTimelinePoint {
  id: string
  index: number
  lane: number
  x: number
  y: number
}
export interface ArchiveTimelineEdge {
  childId: string
  parentId: string
  path: string
  uncertain: boolean
}
export interface ArchiveTimelineLayoutOptions {
  rowHeight?: number
  maxWidth?: number
}

export const ARCHIVE_TIMELINE_WINDOW_SIZE = 160
/** Metadata refreshes keep a gesture valid only for the same ordered identities. */
export function archiveTimelineSameIds(
  previous: readonly string[],
  current: readonly string[],
): boolean {
  return previous.length === current.length && previous.every((id, index) => id === current[index])
}
/** Keep the selected point reachable without rendering an entire large archive. */
export function archiveTimelineWindowStart(
  count: number,
  index: number,
  size = ARCHIVE_TIMELINE_WINDOW_SIZE,
): number {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Number.isFinite(index) ||
    !Number.isSafeInteger(size) ||
    size < 1
  )
    throw Error('Invalid archive timeline window')
  return Math.max(0, Math.min(Math.max(0, count - size), Math.floor(index - size / 2)))
}

/** Source links only: display order never manufactures a parent relationship. */
export function archiveTimelineLayout(
  nodes: readonly ArchiveTimelineNode[],
  { rowHeight = 48, maxWidth = 96 }: ArchiveTimelineLayoutOptions = {},
) {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0 || !Number.isFinite(maxWidth) || maxWidth < 24)
    throw Error('Invalid archive timeline layout')
  const points: ArchiveTimelinePoint[] = [],
    byId = new Map<string, ArchiveTimelinePoint>()
  const continued = new Set<string>()
  let lanes = 1
  for (const [index, node] of nodes.entries()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    const lane = parent ? (continued.has(parent.id) ? lanes++ : parent.lane) : 0
    if (parent) continued.add(parent.id)
    const point = { id: node.id, index, lane, x: 0, y: index * rowHeight + rowHeight / 2 }
    points.push(point)
    byId.set(node.id, point)
  }
  const width = Math.min(maxWidth, 24 + lanes * 12)
  for (const point of points) point.x = lanes === 1 ? 16 : 12 + (point.lane * (width - 24)) / (lanes - 1)
  const edges: ArchiveTimelineEdge[] = []
  for (const node of nodes) {
    const point = byId.get(node.id),
      parent = node.parentId ? byId.get(node.parentId) : undefined
    if (!point || !parent || point.id === parent.id) continue
    const middle = (point.y + parent.y) / 2
    edges.push({
      childId: node.id,
      parentId: parent.id,
      path: `M ${parent.x} ${parent.y} C ${parent.x} ${middle}, ${point.x} ${middle}, ${point.x} ${point.y}`,
      uncertain: Boolean(node.uncertain || parent.index >= point.index),
    })
  }
  return { points, edges, width, height: Math.max(rowHeight, nodes.length * rowHeight) }
}
