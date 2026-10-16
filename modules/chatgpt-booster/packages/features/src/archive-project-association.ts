import { normalizeConversationProjectId } from './conversation-records'

/** A change to current catalog association, never a rewrite of message originals. */
export interface FixedProjectAssociation {
  previousProjectId: string | null
  projectId: string | null
  readId: string
  readStartedAt: number
  observedAtMs: number
  sourceKind: 'native'
  sourceVersion: string
  raw: Record<string, unknown>
}
interface AssociationHeader {
  projectId: string | null
  projectAssociations?: readonly FixedProjectAssociation[]
}
const id = (value: unknown) => typeof value === 'string' && !!value && value.length <= 256
const project = (value: unknown) => value === null || id(value)
export function validateProjectAssociations(header: AssociationHeader): void {
  const history = header.projectAssociations
  if (history === undefined) return
  if (!Array.isArray(history) || !history.length) throw Error('Invalid project association history')
  let previous: FixedProjectAssociation | undefined
  for (const item of history) {
    if (
      !item ||
      !project(item.previousProjectId) ||
      !project(item.projectId) ||
      item.previousProjectId === item.projectId ||
      !id(item.readId) ||
      !Number.isSafeInteger(item.readStartedAt) ||
      item.readStartedAt < 0 ||
      !Number.isSafeInteger(item.observedAtMs) ||
      item.observedAtMs < item.readStartedAt ||
      item.sourceKind !== 'native' ||
      !id(item.sourceVersion) ||
      !item.raw ||
      typeof item.raw !== 'object' ||
      Array.isArray(item.raw) ||
      !Object.hasOwn(item.raw, 'gizmo_id') ||
      (item.raw.gizmo_id !== null && typeof item.raw.gizmo_id !== 'string') ||
      normalizeConversationProjectId(item.raw) !== item.projectId ||
      (previous &&
        (item.previousProjectId !== previous.projectId || item.readStartedAt <= previous.readStartedAt))
    )
      throw Error('Invalid or stale project association evidence')
    previous = item
  }
  if (previous?.projectId !== header.projectId)
    throw Error('Current project disagrees with association evidence')
}
export function originalConversationProject(header: AssociationHeader): string | null {
  const first = header.projectAssociations?.[0]
  return first ? first.previousProjectId : header.projectId
}
export function sourceProjectBelongsToConversation(
  header: AssociationHeader,
  projectId: string | null,
): boolean {
  return (
    header.projectId === projectId ||
    Boolean(
      header.projectAssociations?.some(
        (item) => item.previousProjectId === projectId || item.projectId === projectId,
      ),
    )
  )
}
