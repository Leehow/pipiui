import type { AgentDiagnostics, AgentState } from '@pipi/host-api'
import { formatFinalizationLine, isTerminalFinalizingPhase } from './agent-finalization'

export type StallDiagnosticKind =
  | 'output-recent'
  | 'cpu-progress'
  | 'tool-quiet-alive'
  | 'child-gone'
  | 'generation-mismatch'
  | 'seq-stale'
  | 'ui-quiet-only'
  | 'watchdog-stalled'
  | 'finalizing'
  | 'healthy'

export type StallDiagnosticView = {
  kind: StallDiagnosticKind
  conclusion: string
  fields: Array<{ label: string; value: string }>
}

const SEQ_STALE_MS = 60_000

export function diagnoseAgentProgress(input: {
  now: number
  state: AgentState
  updatedAt?: number
  stalled?: boolean
  diagnostics?: AgentDiagnostics
}): StallDiagnosticView {
  const d = input.diagnostics
  const quietSeconds = input.updatedAt === undefined
    ? undefined
    : Math.max(0, Math.floor((input.now - input.updatedAt) / 1000))

  if (isTerminalFinalizingPhase(d?.finalizationPhase)) {
    return view('finalizing', formatFinalizationLine(d, input.now) ?? '子任务已进入收尾，不是模型静默卡住。', input, quietSeconds)
  }
  if (d?.persistedRunning || d?.reconciliation === 'interrupted' || d?.generationMatch === false) {
    return view('generation-mismatch', '宿主或运行时进程世代已变化，这是重启后的遗留运行态，不是当前实时卡住。', input, quietSeconds)
  }
  if (
    d?.cpuVerdict === 'gone'
    || d?.watchdogDecision === 'no-process'
    || d?.watchdogDecision === 'process-exited'
    || Boolean(d?.exitReason)
  ) {
    return view('child-gone', '子进程已退出或当前世代找不到对应进程，状态可能尚未回收。', input, quietSeconds)
  }
  const hostAge = d?.hostReceivedAt === undefined ? undefined : input.now - d.hostReceivedAt
  if (hostAge !== undefined && hostAge >= SEQ_STALE_MS) {
    return view('seq-stale', '运行时/后端事件链路长时间没有新的宿主接收，链路可能中断或宿主未收到新探针。', input, quietSeconds)
  }
  if (d?.watchdogDecision === 'output-recent') {
    return view('output-recent', '工具仍在执行：子进程最近仍有输出，尚未构成真实卡死。', input, quietSeconds)
  }
  if (d?.watchdogDecision === 'cpu-progress' || d?.cpuVerdict === 'working') {
    return view('cpu-progress', '工具仍在执行：子进程 CPU 最近仍有推进，尚未构成真实卡死。', input, quietSeconds)
  }
  if (d?.watchdogDecision === 'tool-quiet-alive') {
    return view('tool-quiet-alive', '工具仍在执行：尚未越过卡住门槛，但未见 CPU 或输出推进。', input, quietSeconds)
  }
  if (d?.watchdogDecision === 'first-stall-notify' || d?.watchdogDecision === 'final-abort' || input.stalled || input.state === 'stalled') {
    return view('watchdog-stalled', '运行时看门狗已给出卡住判定，这不是仅界面时钟在增长。', input, quietSeconds)
  }
  if (quietSeconds !== undefined && quietSeconds >= 30) {
    return view('ui-quiet-only', '仅界面 updatedAt 静默预警，尚无真实卡死证据。', input, quietSeconds)
  }
  return view('healthy', '诊断探针未见卡住证据。', input, quietSeconds)
}

function view(
  kind: StallDiagnosticKind,
  conclusion: string,
  input: { now: number; updatedAt?: number; diagnostics?: AgentDiagnostics },
  quietSeconds: number | undefined,
): StallDiagnosticView {
  const d = input.diagnostics
  const fields: Array<{ label: string; value: string }> = []
  push(fields, '诊断结论', conclusion)
  if (d?.finalizationPhase) push(fields, '收尾阶段', d.finalizationPhase)
  if (d?.phaseSince !== undefined) push(fields, '阶段已持续', ageLabel(input.now, d.phaseSince))
  if (d?.verifyElapsedMs !== undefined) push(fields, '验证耗时', `${d.verifyElapsedMs}ms`)
  if (d?.reconcileElapsedMs !== undefined) push(fields, '对账耗时', `${d.reconcileElapsedMs}ms`)
  if (d?.mergeElapsedMs !== undefined) push(fields, '合并耗时', `${d.mergeElapsedMs}ms`)
  if (d?.cleanupElapsedMs !== undefined) push(fields, '清理耗时', `${d.cleanupElapsedMs}ms`)
  if (d?.lastPhaseError) push(fields, '阶段代码', d.lastPhaseError)
  if (d?.eventSeq !== undefined) push(fields, '事件序号', String(d.eventSeq))
  if (d?.seqGap !== undefined) push(fields, '序号间隔', String(d.seqGap))
  if (d?.processGeneration) push(fields, '运行时世代', d.processGeneration)
  if (d?.hostGeneration) push(fields, '宿主世代', d.hostGeneration)
  if (d?.supervisorPid !== undefined) push(fields, '主管 PID', String(d.supervisorPid))
  if (d?.childPid !== undefined) push(fields, '子进程 PID', String(d.childPid))
  if (d?.toolWaitName) push(fields, '当前工具', d.toolWaitName)
  if (d?.watchdogDecision) push(fields, '看门狗判定', d.watchdogDecision)
  if (d?.watchdogReason) push(fields, '判定原因', d.watchdogReason)
  if (d?.cpuVerdict) push(fields, 'CPU', d.cpuVerdict)
  if (d?.lastCpuDeltaMs !== undefined) push(fields, 'CPU 增量', `${d.lastCpuDeltaMs}ms`)
  if (d?.stdoutBytes !== undefined || d?.stderrBytes !== undefined) {
    push(fields, '输出字节', `${d?.stdoutBytes ?? 0}+${d?.stderrBytes ?? 0}`)
  }
  if (d?.hostReceivedAt !== undefined) push(fields, '宿主收到', ageLabel(input.now, d.hostReceivedAt))
  if (input.updatedAt !== undefined) push(fields, '界面 updatedAt', ageLabel(input.now, input.updatedAt))
  if (quietSeconds !== undefined) push(fields, '界面静默', `${quietSeconds} 秒`)
  if (d?.abortReason) push(fields, '中止原因', d.abortReason)
  if (d?.exitReason) push(fields, '退出原因', d.exitReason)
  return { kind, conclusion, fields }
}

function push(fields: Array<{ label: string; value: string }>, label: string, value: string) {
  fields.push({ label, value })
}

function ageLabel(now: number, at: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  return `${seconds} 秒前`
}
