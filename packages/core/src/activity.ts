import type { ToolInvocationView } from './archive'

export type AgentActivityPhase = 'idle' | 'thinking' | 'tool' | 'responding' | 'complete'

export interface AgentActivitySnapshot {
  conversationId: string | null
  turnId: string | null
  active: boolean
  phase: AgentActivityPhase
  startedAt: number | null
  reasoningStartedAt: number | null
  phaseStartedAt: number | null
  completedAt: number | null
  lastActivityAt: number | null
  durationMs: number | null
  reasoningDurationMs: number | null
  label: string | null
  tool: ToolInvocationView | null
}

export const AGENT_ACTIVITY_EVENT = 'chatgpt-booster:agent-activity'
