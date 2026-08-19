import { describe, expect, it } from 'vitest'
import {
  PLAN_PROMPT_BARE,
  PLAN_PROMPT_WITH_ARGS,
  filterSlashCommands,
  parseSlashInvocation,
  planPromptFromArgs,
  slashCommandByName,
  slashCommands
} from './slash-commands'

describe('slash command registry', () => {
  it('includes plan and goal with Chinese descriptions and send actions', () => {
    const plan = slashCommandByName('plan')
    const goal = slashCommandByName('goal')
    expect(plan).toMatchObject({
      name: 'plan',
      description: '为目标制定正式计划',
      action: { kind: 'send-plan' }
    })
    expect(goal).toMatchObject({
      name: 'goal',
      description: '设定自主完成的目标',
      action: { kind: 'send-prompt' }
    })
    expect(slashCommands.map(command => command.name)).toEqual(['model', 'compact', 'plan', 'goal'])
  })

  it('surfaces plan and goal in the autocomplete list', () => {
    const names = filterSlashCommands('').map(command => command.name)
    expect(names).toContain('plan')
    expect(names).toContain('goal')
    expect(filterSlashCommands('pl')[0]?.name).toBe('plan')
    expect(filterSlashCommands('go')[0]?.name).toBe('goal')
  })
})

describe('planPromptFromArgs', () => {
  it('prefixes args so the user explicitly asked for a formal plan', () => {
    expect(planPromptFromArgs('实现登录')).toBe(`${PLAN_PROMPT_WITH_ARGS}实现登录`)
    expect(planPromptFromArgs('  实现登录  ')).toBe(`${PLAN_PROMPT_WITH_ARGS}实现登录`)
  })

  it('uses the bare formal-plan request when args are empty', () => {
    expect(planPromptFromArgs('')).toBe(PLAN_PROMPT_BARE)
    expect(planPromptFromArgs('   ')).toBe(PLAN_PROMPT_BARE)
  })
})

describe('parseSlashInvocation', () => {
  it('splits /plan and /goal the same way as other commands', () => {
    expect(parseSlashInvocation('/plan 实现登录')).toEqual({ name: 'plan', args: '实现登录' })
    expect(parseSlashInvocation('/plan')).toEqual({ name: 'plan', args: '' })
    expect(parseSlashInvocation('/goal status')).toEqual({ name: 'goal', args: 'status' })
    expect(parseSlashInvocation('/goal --tokens 100k xxx')).toEqual({ name: 'goal', args: '--tokens 100k xxx' })
  })
})
