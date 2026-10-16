import type { ArchiveCaptureContext } from '@chatgpt-booster/core'

export interface SourceScopeConversation {
  conversationId: string
  projectId: string | null
  title?: string | null
}
export interface ArchiveScopeSource {
  ownerId: string | null
  nativeConversation(id: string): SourceScopeConversation | undefined
  savedConversation(id: string): SourceScopeConversation | undefined
  savedProject(id: string): { projectId: string; title: string | null } | undefined
  currentNativeProjectId: string | null
}

/** A DOM location may propose an ID, but only verified provider evidence owns
 * a business target. Labels and URL project ancestry never establish identity. */
export function sourceScopeContext(
  candidate: ArchiveCaptureContext,
  source: ArchiveScopeSource,
): ArchiveCaptureContext | undefined {
  if (!source.ownerId) return undefined
  if (candidate.scope === 'conversation') {
    const conversation =
      source.nativeConversation(candidate.id) ?? source.savedConversation(candidate.id)
    return conversation?.conversationId === candidate.id
      ? {
          scope: 'conversation',
          id: conversation.conversationId,
          projectId: conversation.projectId,
          title: conversation.title ?? null,
        }
      : undefined
  }
  const project = source.savedProject(candidate.id)
  return project?.projectId === candidate.id || source.currentNativeProjectId === candidate.id
    ? {
        scope: 'project',
        id: candidate.id,
        title: project?.title ?? null,
      }
    : undefined
}
