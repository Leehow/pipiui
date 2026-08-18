import { describe, expect, it } from 'vitest'
import { isTrivialBrowserEval } from '../../../resources/runtime/extensions/browser-eval-guard.ts'

describe('isTrivialBrowserEval', () => {
  it('rejects keep-alive literals and identity IIFEs', () => {
    const rejects = [
      "'o'",
      '"p"',
      '`x2`',
      "(() => 'o')()",
      '( () => "p" )()',
      "(()=>'q')()",
      "(() => { return 'r' })()",
      '(() => {return "s"})()',
      "(function(){return 't'})()",
      "(function () { return 'u' }())",
      "((() => 'o')())",
      'true',
      'false',
      'null',
      'undefined',
      'void 0',
      '42',
      '',
      '   ',
      '// only comment',
      '/* block */',
    ]
    for (const js of rejects) expect(isTrivialBrowserEval(js), js).toBe(true)
  })

  it('allows page-touching scripts', () => {
    const allows = [
      'document.title',
      "document.querySelector('a')?.textContent",
      '(() => document.body.innerText)()',
      'location.href',
      'window.scrollY',
      "document.querySelectorAll('button').length",
    ]
    for (const js of allows) expect(isTrivialBrowserEval(js), js).toBe(false)
  })
})
