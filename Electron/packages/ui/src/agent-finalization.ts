import type { AgentDiagnostics, AgentFinalizationPhase, AgentState } from '@pipi/host-api'

const PHASE_ORDER: AgentFinalizationPhase[] = [
  'generating',
  'tool-active',
  'final-received',
  'verifying',
  'reconciling',
  'merging',
  'cleaning',
  'post-verify',
  'done-await-host',
]

export function isTerminalFinalizingPhase(phase: AgentFinalizationPhase | undefined): boolean {
  return phase !== undefined && PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf('final-received')
}

const PHASE_LABEL: Record<AgentFinalizationPhase, string> = {
  generating: '',
  'tool-active': '',
  'final-received': '收尾中：总结已完成',
  verifying: '收尾中：验证',
  reconciling: '收尾中：对账',
  merging: '收尾中：合并',
  'post-verify': '收尾中：合并后验证',
  cleaning: '收尾中：清理',
  'done-await-host': '收尾中：等待状态同步',
}

export function finalizationElapsedSeconds(phaseSince: number | undefined, now: number): number | undefined {
  if (phaseSince === undefined || !Number.isFinite(phaseSince)) return undefined
  return Math.max(0, Math.floor((now - phaseSince) / 1000))
}

export function formatFinalizationLine(
  diagnostics: AgentDiagnostics | undefined,
  now = Date.now(),
): string | undefined {
  const phase = diagnostics?.finalizationPhase
  if (!isTerminalFinalizingPhase(phase) || !phase) return undefined
  const label = PHASE_LABEL[phase]
  if (!label) return undefined
  const seconds = finalizationElapsedSeconds(diagnostics?.phaseSince, now)
  return seconds === undefined ? label : `${label} · ${seconds}s`
}

export function formatReconcileOrMissingLine(diagnostics: AgentDiagnostics | undefined): string | undefined {
  if (diagnostics?.persistedRunning || diagnostics?.reconciliation === 'interrupted' || diagnostics?.generationMatch === false) {
    return '进程已中断，正在对账'
  }
  if (
    diagnostics?.cpuVerdict === 'gone'
    || diagnostics?.watchdogDecision === 'no-process'
    || diagnostics?.watchdogDecision === 'process-exited'
    || Boolean(diagnostics?.exitReason)
  ) {
    return '进程已消失，正在对账'
  }
  return undefined
}

export function liveRunningProgressLine(input: {
  state: AgentState
  diagnostics?: AgentDiagnostics
  activityActive?: boolean
  listSubtitle?: string
  now?: number
}): string | undefined {
  if (input.state !== 'running' && input.state !== 'stalled') return undefined
  const now = input.now ?? Date.now()
  return formatFinalizationLine(input.diagnostics, now)
    ?? formatReconcileOrMissingLine(input.diagnostics)
}

export function isFinalizingQuietOverride(diagnostics: AgentDiagnostics | undefined): boolean {
  return Boolean(
    isTerminalFinalizingPhase(diagnostics?.finalizationPhase)
    || diagnostics?.persistedRunning
    || diagnostics?.reconciliation === 'interrupted'
    || diagnostics?.generationMatch === false
    || diagnostics?.cpuVerdict === 'gone'
    || diagnostics?.watchdogDecision === 'no-process'
    || diagnostics?.watchdogDecision === 'process-exited'
    || diagnostics?.exitReason,
  )
}
