import type { ToolInvocationView } from './archive'

export type AgentActivityPhase = 'idle' | 'thinking' | 'tool' | 'responding'

export interface AgentActivitySnapshot {
  conversationId: string | null
  turnId: string | null
  active: boolean
  phase: AgentActivityPhase
  startedAt: number | null
  lastActivityAt: number | null
  label: string | null
  tool: ToolInvocationView | null
}

export const AGENT_ACTIVITY_EVENT = 'chatgpt-booster:agent-activity'
