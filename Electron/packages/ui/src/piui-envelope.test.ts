import { describe, expect, it } from 'vitest'
import { parsePiuiV1Envelope, toToolRenderPayload } from './piui-envelope'

describe('parsePiuiV1Envelope', () => {
  it('extracts details from a leading piui:v1 envelope', () => {
    const raw = '{ "piui:v1": { "kind": "quota", "used": 1200, "limit": 1500 } }'
    expect(parsePiuiV1Envelope(raw)).toEqual({
      kind: 'ok',
      content: '',
      details: { kind: 'quota', used: 1200, limit: 1500 },
    })
  })

  it('keeps trailing prose as content', () => {
    const raw = '{ "piui:v1": { "kind": "quota" } }\nUsed 1200 of 1500'
    expect(parsePiuiV1Envelope(raw)).toEqual({
      kind: 'ok',
      content: 'Used 1200 of 1500',
      details: { kind: 'quota' },
    })
  })

  it('accepts pretty-printed envelopes and a BOM', () => {
    const raw = '\uFEFF{\n  "piui:v1": {\n    "used": 1\n  }\n}'
    expect(parsePiuiV1Envelope(raw)).toEqual({
      kind: 'ok',
      content: '',
      details: { used: 1 },
    })
  })

  it('treats missing envelope as none', () => {
    expect(parsePiuiV1Envelope('plain tool output')).toEqual({
      kind: 'none',
      content: 'plain tool output',
    })
    expect(parsePiuiV1Envelope('{ "episodeLedger": [] }')).toEqual({
      kind: 'none',
      content: '{ "episodeLedger": [] }',
    })
    expect(parsePiuiV1Envelope(undefined)).toEqual({ kind: 'none', content: '' })
  })

  it('treats a broken piui:v1 prefix as invalid', () => {
    expect(parsePiuiV1Envelope('{ "piui:v1": { "kind": "quota" }').kind).toBe('invalid')
    expect(parsePiuiV1Envelope('{ "piui:v1": not-json }').kind).toBe('invalid')
    expect(parsePiuiV1Envelope('{ "piui:v1": }').kind).toBe('invalid')
  })
})

describe('toToolRenderPayload', () => {
  it('passes content and details for a valid envelope', () => {
    expect(toToolRenderPayload('{ "piui:v1": { "used": 92 } }')).toEqual({
      fallback: false,
      content: '',
      details: { used: 92 },
    })
  })

  it('falls back on invalid envelope and leaves missing envelope without details', () => {
    expect(toToolRenderPayload('{ "piui:v1": {')).toEqual({ fallback: true })
    expect(toToolRenderPayload('no envelope')).toEqual({ fallback: false, content: 'no envelope' })
  })
})
