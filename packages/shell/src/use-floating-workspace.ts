import { shellInstanceKey } from '@kobaproduction/browser-core'
import {
  type Viewport,
  type WorkspaceRatios,
  type WorkspaceRect,
  workspaceRatios,
  workspaceRect,
} from '@kobaproduction/browser-widgets'
import { computed, ref } from 'vue'

export function useFloatingWorkspace(viewport: () => Viewport) {
  const workspace = ref<WorkspaceRect>({ x: 0, y: 0, width: 720, height: 640 })
  let lastViewport: Viewport = { width: 1024, height: 768 }
  const DEFAULT_WORKSPACE: WorkspaceRatios = {
    xRatio: 0.08,
    yRatio: 0.08,
    widthRatio: 0.72,
    heightRatio: 0.82,
  }
  const WORKSPACE_KEY = 'koba-browser:floating-workspace'
  let workspaceDrag:
    | { pointerId: number; kind: 'move' | 'resize'; startX: number; startY: number; rect: WorkspaceRect }
    | undefined
  function restoreWorkspace(side: 'left' | 'right') {
    lastViewport = viewport()
    // First opening follows the user's persisted launcher edge.
    let ratios: WorkspaceRatios = {
      ...DEFAULT_WORKSPACE,
      xRatio: side === 'left' ? 0 : 1,
    }
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(shellInstanceKey(WORKSPACE_KEY)) || 'null')
      if (
        saved &&
        typeof saved === 'object' &&
        ['xRatio', 'yRatio', 'widthRatio', 'heightRatio'].every((key) => {
          const value: unknown = (saved as Record<string, unknown>)[key]
          return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
        })
      ) {
        ratios = saved as WorkspaceRatios
      }
    } catch {
      /* storage or saved geometry unavailable */
    }
    workspace.value = workspaceRect(ratios, lastViewport)
  }
  function saveWorkspace() {
    try {
      localStorage.setItem(
        shellInstanceKey(WORKSPACE_KEY),
        JSON.stringify(workspaceRatios(workspace.value, viewport())),
      )
    } catch {
      /* ephemeral geometry is still usable */
    }
  }
  function updateWorkspaceRect(next: WorkspaceRect) {
    workspace.value = workspaceRect(workspaceRatios(next, viewport()), viewport())
  }
  function onWorkspaceDown(event: PointerEvent, kind: 'move' | 'resize') {
    if (event.button !== 0) return
    updateWorkspaceRect(workspace.value)
    workspaceDrag = {
      pointerId: event.pointerId,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      rect: { ...workspace.value },
    }
    try {
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    } catch {}
    event.preventDefault()
  }
  function onWorkspaceMove(event: PointerEvent) {
    const drag = workspaceDrag
    if (!drag || event.pointerId !== drag.pointerId) return
    const dx = event.clientX - drag.startX,
      dy = event.clientY - drag.startY
    updateWorkspaceRect(
      drag.kind === 'move'
        ? { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }
        : { ...drag.rect, width: drag.rect.width + dx, height: drag.rect.height + dy },
    )
  }
  function onWorkspaceUp(event: PointerEvent) {
    if (!workspaceDrag || event.pointerId !== workspaceDrag.pointerId) return
    workspaceDrag = undefined
    saveWorkspace()
  }
  function onWorkspaceKey(event: KeyboardEvent, kind: 'move' | 'resize') {
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const step = movement[event.key]
    if (!step) return
    event.preventDefault()
    event.stopPropagation()
    const delta = event.shiftKey ? 48 : 16
    const [dx, dy] = step
    const rect = workspace.value
    updateWorkspaceRect(
      kind === 'move'
        ? { ...rect, x: rect.x + dx * delta, y: rect.y + dy * delta }
        : { ...rect, width: rect.width + dx * delta, height: rect.height + dy * delta },
    )
    saveWorkspace()
  }
  const workspaceStyle = computed(() => {
    // Rendering and pointer motion consume the same normalized rectangle.
    const { width, height, x, y } = workspace.value
    return { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }
  })
  function cancelWorkspaceDrag() {
    workspaceDrag = undefined
  }
  function normalizeWorkspace() {
    updateWorkspaceRect(workspace.value)
  }
  function rebaseWorkspace() {
    cancelWorkspaceDrag()
    const next = viewport()
    workspace.value = workspaceRect(workspaceRatios(workspace.value, lastViewport), next)
    lastViewport = next
  }
  return {
    workspaceStyle,
    restoreWorkspace,
    cancelWorkspaceDrag,
    normalizeWorkspace,
    rebaseWorkspace,
    onWorkspaceDown,
    onWorkspaceMove,
    onWorkspaceUp,
    onWorkspaceKey,
  }
}
