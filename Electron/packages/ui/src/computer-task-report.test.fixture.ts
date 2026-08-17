/** Shared realistic Computer Use payloads for parser and component tests. */
export const PLAN_JSON = JSON.stringify({
  goal: 'Visually verify the bottom of Settings in the already-running COC Keeper app twice, then independently confirm the final state.',
  mode: 'planned',
  successConditions: [
    { kind: 'visual_judgement', description: 'Settings is visibly at its bottom and both the PDF parsing section and capability status section are visible.' },
  ],
  procedureContext: {
    application: { bundleId: 'org.chatrpg.cockeyper', appName: 'COC Keeper' },
    parameters: { requiredSections: 'PDF parsing section and capability status section' },
  },
  steps: [
    {
      id: 'operator-settings-cycle',
      role: 'gui-operator',
      objective: 'Using desktop UI only, activate the already-running COC Keeper app without CMD+TAB; open Settings and scroll to the bottom.',
      dependsOn: [],
      postconditions: [{ kind: 'visual_judgement', description: 'Settings is visibly at its bottom and both sections are visible.' }],
    },
    {
      id: 'verifier-final-bottom-state',
      role: 'verifier',
      objective: 'Independently observe the visible COC Keeper UI and confirm the final Settings bottom state.',
      dependsOn: ['operator-settings-cycle'],
      postconditions: [{ kind: 'visual_judgement', description: 'Settings is visibly at its bottom and both sections are visible.' }],
    },
  ],
})

export const RESULT_TEXT = `Blocked: Settings bottom state was not visually verified.

Episode ledger:
${JSON.stringify({
  episodeLedger: [
    { agentId: 'cua-lead-1', runId: 'run-1', parentId: null, name: 'computer-use-leader', role: 'computer-use-leader', terminalState: 'failed', result: { outcome: 'blocked', summary: 'Computer Task blocked' } },
    { agentId: 'cua-op-abc', runId: 'msw1', parentId: 'cua-lead-1', name: 'operator', role: 'gui-operator', terminalState: 'failed', result: { outcome: 'failed', summary: 'Worker failed', failureCode: 'gui_child_failed' } },
  ],
  plan: JSON.parse(PLAN_JSON),
  verification: { status: 'not_verified', conditionResults: [{ conditionId: 'task:condition:0', outcome: 'not_verified' }] },
  planRevisions: 2,
  investigation: {
    stage: 'recovery_exhausted',
    code: 'worker_failed',
    workerAttempts: [
      { stepId: 'operator-settings-cycle', role: 'gui-operator', outcome: 'failed', verification: 'not_verified', failureCode: 'gui_child_failed' },
    ],
  },
})}`
