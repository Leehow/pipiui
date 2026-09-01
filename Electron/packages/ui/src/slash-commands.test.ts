import { describe, expect, it } from 'vitest'
import {
  PLAN_PROMPT_BARE,
  PLAN_PROMPT_WITH_ARGS,
  SELFDEV_PROMPT_BARE,
  SELFDEV_PROMPT_WITH_ARGS,
  filterSlashCommands,
  parseSlashInvocation,
  planPromptFromArgs,
  selfdevPromptFromArgs,
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
    expect(slashCommands.map(command => command.name)).toEqual(['model', 'compact', 'plan', 'goal', 'selfdev'])
  })

  it('registers selfdev with the send-selfdev action and a Chinese description', () => {
    expect(slashCommandByName('selfdev')).toMatchObject({
      name: 'selfdev',
      description: '用自然语言改扩展或加新功能并热重载',
      action: { kind: 'send-selfdev' }
    })
  })

  it('surfaces plan and goal in the autocomplete list', () => {
    const names = filterSlashCommands('').map(command => command.name)
    expect(names).toContain('plan')
    expect(names).toContain('goal')
    expect(filterSlashCommands('pl')[0]?.name).toBe('plan')
    expect(filterSlashCommands('go')[0]?.name).toBe('goal')
  })
})

describe('selfdevPromptFromArgs', () => {
  it('primes the agent with the selfdev skill plus the request', () => {
    expect(selfdevPromptFromArgs('把 grok 上下文窗口改成 700')).toBe(`${SELFDEV_PROMPT_WITH_ARGS}把 grok 上下文窗口改成 700`)
    expect(selfdevPromptFromArgs('  改主题色  ')).toBe(`${SELFDEV_PROMPT_WITH_ARGS}改主题色`)
  })

  it('uses the bare ask-what-to-change prompt when args are empty', () => {
    expect(selfdevPromptFromArgs('')).toBe(SELFDEV_PROMPT_BARE)
    expect(selfdevPromptFromArgs('   ')).toBe(SELFDEV_PROMPT_BARE)
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
