import { describe, expect, it } from 'vitest'
import {
  computerOutcomeLabel,
  computerRoleLabel,
  computerStepStatuses,
  computerTaskOutcome,
  parseComputerPlanSegment,
  parseComputerTaskResult,
  parseComputerWorkerResult,
} from './computer-task-report'
// Runtime import from the Electron-owned extension source: asserts the text
// envelope contract the parsers above are built against.
import { computerTaskContent } from '../../../resources/runtime/pi-ext/packages/computer-agent/src/coordinator'
import { PLAN_JSON, RESULT_TEXT } from './computer-task-report.test.fixture'

describe('parseComputerPlanSegment', () => {
  it('parses a complete plan JSON into a structured view', () => {
    const view = parseComputerPlanSegment(PLAN_JSON)
    expect(view).not.toBeNull()
    expect(view!.complete).toBe(true)
    expect(view!.goal).toContain('Visually verify the bottom of Settings')
    expect(view!.steps).toHaveLength(2)
    expect(view!.steps[0]).toMatchObject({ id: 'operator-settings-cycle', role: 'gui-operator' })
    expect(view!.steps[1].dependsOn).toEqual(['operator-settings-cycle'])
    expect(view!.successConditions).toHaveLength(1)
    expect(view!.successConditions[0].text).toContain('Settings is visibly at its bottom')
  })

  it('parses a fenced plan, closed or still streaming', () => {
    expect(parseComputerPlanSegment(`\`\`\`json\n${PLAN_JSON}\n\`\`\``)?.complete).toBe(true)
    expect(parseComputerPlanSegment(`\`\`\`json\n${PLAN_JSON}`)?.complete).toBe(true)
  })

  it('projects a growing card from a partial streaming snapshot', () => {
    const partial = PLAN_JSON.slice(0, PLAN_JSON.indexOf('"dependsOn"'))
    const view = parseComputerPlanSegment(partial)
    expect(view).not.toBeNull()
    expect(view!.complete).toBe(false)
    expect(view!.goal).toContain('Visually verify the bottom of Settings')
    // First step fully streamed, second step not reached yet.
    expect(view!.steps).toHaveLength(1)
    expect(view!.steps[0].objective).toContain('activate the already-running COC Keeper app')
    expect(view!.successConditions).toHaveLength(1)
  })

  it('scrapes a half-streamed step objective', () => {
    const partial = `${PLAN_JSON.slice(0, PLAN_JSON.indexOf('activate the already-running') + 14)}`
    const view = parseComputerPlanSegment(partial)
    expect(view).not.toBeNull()
    // The value is still streaming: the scrape returns everything after the
    // opening quote up to the cut, i.e. the objective typed so far.
    expect(view!.steps[0].objective).toBe('Using desktop UI only, activate the a')
  })

  it('returns null for non-plan text', () => {
    expect(parseComputerPlanSegment('任务已完成，Settings 已验证。')).toBeNull()
    expect(parseComputerPlanSegment('{"goal":"x"}')).toBeNull()
    expect(parseComputerPlanSegment('{"steps":[]}')).toBeNull()
    expect(parseComputerPlanSegment('')).toBeNull()
  })
})

function ledgerEnvelope(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    episodeLedger: [
      { agentId: 'cua-lead-1', runId: 'run-1', parentId: null, name: 'computer-use-leader', role: 'computer-use-leader', terminalState: 'failed', result: { outcome: 'blocked', summary: 'Computer Task blocked' } },
      { agentId: 'cua-op-abc', runId: 'msw1', parentId: 'cua-lead-1', name: 'operator', role: 'gui-operator', terminalState: 'failed', result: { outcome: 'failed', summary: 'Worker failed', failureCode: 'gui_child_failed' } },
    ],
    ...extra,
  })
}

describe('parseComputerTaskResult', () => {
  it('splits the leader prose from the episode ledger envelope', () => {
    const view = parseComputerTaskResult(RESULT_TEXT)
    expect(view).not.toBeNull()
    expect(view!.summary).toContain('Blocked: Settings bottom state')
    expect(view!.episodes).toHaveLength(2)
    expect(view!.episodes[1]).toMatchObject({ agentId: 'cua-op-abc', role: 'gui-operator', outcome: 'failed' })
    expect(view!.plan?.steps).toHaveLength(2)
    expect(view!.verification?.conditionResults[0].outcome).toBe('not_verified')
    expect(view!.investigation?.workerAttempts).toHaveLength(1)
  })

  it('derives per-step statuses from worker attempts', () => {
    const view = parseComputerTaskResult(RESULT_TEXT)!
    const statuses = computerStepStatuses(view)
    expect(statuses[0]).toMatchObject({ status: 'failed' })
    expect(statuses[0].attempt?.failureCode).toBe('gui_child_failed')
    expect(statuses[1].status).toBe('pending')
  })

  it('marks a verified attempt as ok, including synthetic verifier passes', () => {
    const view = parseComputerTaskResult(`Summary\n\nEpisode ledger:\n${ledgerEnvelope({
      plan: JSON.parse(PLAN_JSON),
      investigation: { workerAttempts: [
        { stepId: 'operator-settings-cycle', role: 'gui-operator', outcome: 'completed', verification: 'unknown' },
        { stepId: 'operator-settings-cycle-verify', role: 'verifier', outcome: 'verified', verification: 'verified' },
      ] },
    })}`)!
    const statuses = computerStepStatuses(view)
    expect(statuses[0].status).toBe('ok')
    expect(statuses[1].status).toBe('pending')
  })

  it('accepts a legacy ledger-only envelope', () => {
    const view = parseComputerTaskResult(`Summary.\n\nEpisode ledger:\n${ledgerEnvelope()}`)
    expect(view).not.toBeNull()
    expect(view!.plan).toBeUndefined()
    expect(computerStepStatuses(view!)).toHaveLength(0)
  })

  it('projects the single Computer Use Agent episode and its evidence claims', () => {
    const envelope = JSON.stringify({
      episodeLedger: [{ agentId: 'computer-use-1', runId: 'run-1', parentId: null, name: 'computer-use', role: 'computer-use-agent', terminalState: 'ok', result: { outcome: 'succeeded', summary: 'Saved' } }],
      verification: { status: 'verified', claims: [{ claim: 'The saved value is visible', evidenceRef: 'observation:9' }] },
    })
    const view = parseComputerTaskResult(`Saved\n\nEpisode ledger:\n${envelope}`)!
    expect(view.episodes).toHaveLength(1)
    expect(view.episodes[0]).toMatchObject({ role: 'computer-use-agent', outcome: 'succeeded' })
    expect(view.verification?.claims).toEqual([{ claim: 'The saved value is visible', evidenceRef: 'observation:9' }])
    expect(computerTaskOutcome(view)).toEqual({ label: '任务完成', ok: true })
    expect(computerRoleLabel('computer-use-agent')).toBe('Computer Use')
  })

  it('returns null for missing marker or malformed ledger', () => {
    expect(parseComputerTaskResult('Just prose, no ledger.')).toBeNull()
    expect(parseComputerTaskResult('S\n\nEpisode ledger:\nnot json')).toBeNull()
    expect(parseComputerTaskResult('S\n\nEpisode ledger:\n{"other":1}')).toBeNull()
  })
})

describe('parseComputerWorkerResult', () => {
  it('parses a closed worker verdict into a structured view', () => {
    const view = parseComputerWorkerResult('{"outcome":"completed","summary":"目标应用主窗口已刷新观察并显示所需文本。"}')
    expect(view).not.toBeNull()
    expect(view).toMatchObject({
      outcome: 'completed',
      summary: '目标应用主窗口已刷新观察并显示所需文本。',
      complete: true,
    })
  })

  it('parses verified / failed / blocked verdicts and optional failureCode', () => {
    expect(parseComputerWorkerResult('{"outcome":"verified","summary":"独立观察确认战役卷宗可见。"}')).toMatchObject({
      outcome: 'verified',
      complete: true,
    })
    expect(parseComputerWorkerResult('{"outcome":"failed","summary":"未能打开目标窗口。","failureCode":"gui_child_failed"}')).toMatchObject({
      outcome: 'failed',
      failureCode: 'gui_child_failed',
      complete: true,
    })
    expect(parseComputerWorkerResult('{"outcome":"blocked","summary":"外部前置条件未满足。"}')?.outcome).toBe('blocked')
  })

  it('accepts a fenced verdict and rejects incomplete streaming JSON', () => {
    expect(parseComputerWorkerResult('```json\n{"outcome":"completed","summary":"已完成"}\n```')?.complete).toBe(true)
    expect(parseComputerWorkerResult('{"outcome":"completed","summary":"目标应用')).toBeNull()
    expect(parseComputerWorkerResult('{"outcome":')).toBeNull()
  })

  it('does not treat a leader plan or episode ledger as a worker verdict', () => {
    expect(parseComputerWorkerResult(PLAN_JSON)).toBeNull()
    expect(parseComputerWorkerResult(RESULT_TEXT)).toBeNull()
    expect(parseComputerWorkerResult('验收通过：战役卷宗已显示。')).toBeNull()
    expect(parseComputerWorkerResult('{"goal":"x","summary":"not a verdict"}')).toBeNull()
  })
})

describe('computerTaskOutcome labels', () => {
  it('labels blocked / completed / cancelled tasks from the root episode', () => {
    const blocked = parseComputerTaskResult(RESULT_TEXT)!
    expect(computerTaskOutcome(blocked)).toEqual({ label: '任务受阻', ok: false })
    const completed = parseComputerTaskResult(`Done.\n\nEpisode ledger:\n${JSON.stringify({
      episodeLedger: [{ agentId: 'lead', name: 'computer-use-leader', terminalState: 'ok', result: { outcome: 'completed' } }],
    })}`)!
    expect(computerTaskOutcome(completed)).toEqual({ label: '任务完成', ok: true })
  })
})

describe('label helpers', () => {
  it('localizes roles and outcomes', () => {
    expect(computerRoleLabel('gui-operator')).toBe('操作')
    expect(computerRoleLabel('verifier')).toBe('核验')
    expect(computerRoleLabel('terminal-worker')).toBe('终端')
    expect(computerOutcomeLabel('blocked')).toBe('受阻')
    expect(computerOutcomeLabel('completed')).toBe('完成')
  })
})

describe('runtime computerTaskContent envelope', () => {
  it('keeps episodeLedger first and appends the structured view', () => {
    const details = {
      outcome: 'blocked' as const,
      summary: 'Computer Task blocked',
      verification: { status: 'not_verified' as const, conditionResults: [{ conditionId: 'task:condition:0', outcome: 'not_verified' as const }] },
      planRevisions: 1,
      investigation: {
        stage: 'recovery_exhausted' as const,
        code: 'worker_failed' as const,
        workerAttempts: [{ stepId: 's1', role: 'gui-operator', outcome: 'failed', verification: 'not_verified' }],
      },
      episodes: [
        { agentId: 'lead', runId: 'r0', parentId: null, name: 'computer-use-leader', role: 'computer-use-leader', terminalState: 'failed', result: { outcome: 'blocked', summary: 'x' } },
      ],
    }
    const plan = JSON.parse(PLAN_JSON)
    const text = computerTaskContent(details, 'Blocked summary', plan)
    expect(text.startsWith('Blocked summary\n\nEpisode ledger:\n')).toBe(true)
    const envelope = JSON.parse(text.slice(text.indexOf('{')))
    expect(Object.keys(envelope)[0]).toBe('episodeLedger')
    expect(envelope.plan.goal).toContain('Visually verify')
    expect(envelope.verification.status).toBe('not_verified')
    expect(envelope.planRevisions).toBe(1)
    expect(envelope.investigation.workerAttempts).toHaveLength(1)
    // The emitted envelope must round-trip through the UI parser.
    expect(parseComputerTaskResult(text)?.plan?.steps).toHaveLength(2)
  })

  it('omits plan and investigation when absent', () => {
    const details = {
      outcome: 'cancelled' as const,
      summary: 'Computer Task cancelled',
      verification: { status: 'not_verified' as const, conditionResults: [] },
      planRevisions: 0,
    }
    const envelope = JSON.parse(computerTaskContent(details).slice(computerTaskContent(details).indexOf('{')))
    expect(envelope.episodeLedger).toEqual([])
    expect(envelope.plan).toBeUndefined()
    expect(envelope.investigation).toBeUndefined()
  })
})
