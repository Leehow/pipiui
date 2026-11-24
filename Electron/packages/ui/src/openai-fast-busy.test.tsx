import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'
import { describe, expect, it } from 'vitest'

// Exercise the real private ComposerOptions component, including its extension render context.
const source=readFileSync(new URL('./App.tsx',import.meta.url),'utf8')
const start=source.indexOf('const ComposerOptions = memo(')
const end=source.indexOf('\n})',start)+3
const compiled=await transform(source.slice(start,end)+'\nreturn ComposerOptions;',{loader:'tsx',jsx:'transform',target:'es2020'})
const action={id:'fast.busy-regression',render:(context:any)=>React.createElement('button',{id:'fast-action',disabled:context.disabled},'Fast')}
const stub=()=>null
const Options=new Function('React','memo','Fragment','useComposerActions','ProviderLogo','ThinkingChip','ModelQuickMenu',
  'SessionStatsPill','QuotaPill','BalancePill','isUnreadModel',compiled.code)(
    React,React.memo,React.Fragment,()=>[action],stub,stub,stub,stub,stub,stub,()=>false)
function html(props:Record<string,boolean | undefined>) {
  return renderToStaticMarkup(React.createElement(Options,{hideSessionChrome:false,readOnly:false,streaming:false,
    compacting:false,working:false,thinkingPending:false,statsRefreshKey:0,host:{},sessionId:'a',modelState:null,
    visibility:{},quickOpen:false,...props}))
}
describe('Fast host busy-state boundary',()=>{
  it('forwards the existing aggregate sessionWorking through Composer to the action row',()=>{
    expect(source).toMatch(/<Composer\b[^>]*working=\{sessionWorking\}/)
    expect(source).toMatch(/<ComposerOptions[^>]*working=\{working\}/)
  })
  it.each(['queued','stopping','observed-running'])('disables a %s session even after raw streaming is false',()=>{
    expect(html({working:true})).toMatch(/id="fast-action" disabled=""/)
  })
  it.each([{readOnly:true},{streaming:true},{compacting:true}])('retains the other disabled boundary %j',props=>{
    expect(html(props)).toMatch(/id="fast-action" disabled=""/)
  })
  it('permits idle writable sessions and omits actions for external sessions',()=>{
    expect(html({})).not.toMatch(/id="fast-action" disabled/)
    if (source.slice(start,end).includes('hideSessionChrome'))
      expect(html({hideSessionChrome:true})).not.toContain('fast-action')
  })
})
