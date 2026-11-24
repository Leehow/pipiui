// @vitest-environment jsdom
import * as React from 'react'
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {loadControlledContributions, hasControlledEntry} from './controlled-component-loader'
import {listComposerActions, disposeComposerActions} from './workbench/composer-actions'

const source = '../../../resources/runtime/extensions/openai-fast/app/control.js'
const {createComposerAction} = await import(source)
const Control = createComposerAction(React)
const codex = {provider:'openai-codex',id:'gpt-6.1-sol',api:'openai-codex-responses'}
const flap = {...codex,provider:'flapcode',api:'openai-responses'}
afterEach(() => {cleanup();disposeComposerActions('openai-fast');vi.useRealTimers();vi.restoreAllMocks()})
function fixture() {
  const files=new Map<string,string>()
  const api={subscribeExt:()=>()=>{},data:{
    read:vi.fn(async(path:string)=>({content:files.get(path)||'',bytes:0,truncated:false})),
    write:vi.fn(async(path:string,content:string)=>{files.set(path,content);return {bytes:content.length}}),
  }}
  return {files,api}
}
describe('OpenAI Fast controlled composer action',()=>{
  it('loads through the controlled entry contract and disposes cleanly',async()=>{
    const descriptor={id:'openai-fast',capabilities:['data.read','data.write'],directory:'/tmp/fast',ui:{composerActions:[{id:'openai-fast.toggle',entry:'app/control.js'}]}}
    expect(hasControlledEntry(descriptor)).toBe(true)
    const disposers=await loadControlledContributions(descriptor,{} as any,async()=>({createComposerAction}))
    expect(listComposerActions().map(x=>x.id)).toContain('openai-fast.toggle')
    for(const dispose of disposers)dispose()
    expect(listComposerActions()).toHaveLength(0)
  })
  it('defaults off, persists on/off, hides other providers and separates both providers and models',async()=>{
    const {api}=fixture()
    const view=render(<Control api={api} sessionId="a" model={codex} disabled={false} />)
    await screen.findByRole('button',{name:'Fast off'})
    fireEvent.click(screen.getByTestId('fast-chip'))
    await screen.findByRole('button',{name:'Fast requested'})
    expect(screen.getByTestId('fast-chip').getAttribute('aria-pressed')).toBe('true')
    view.rerender(<Control api={api} sessionId="a" model={flap} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'})
    view.rerender(<Control api={api} sessionId="a" model={{...flap,id:'claude-fast'}} disabled={false}/>)
    expect(screen.queryByTestId('fast-chip')).toBeNull()
    view.rerender(<Control api={api} sessionId="a" model={{...codex,id:'gpt-6-luna'}} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'})
    view.rerender(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast requested'})
    fireEvent.click(screen.getByTestId('fast-chip'))
    await screen.findByRole('button',{name:'Fast off'})
    view.unmount()
    render(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'})
  })
  it('restores the explicit choice after reopening, defaults a new session off, and disables busy/read-only requests',async()=>{
    const {api}=fixture()
    const view=render(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'})
    fireEvent.click(screen.getByTestId('fast-chip'))
    await screen.findByRole('button',{name:'Fast requested'})
    view.unmount()
    const reopened=render(<Control api={api} sessionId="a" model={codex} disabled={true}/>)
    await screen.findByRole('button',{name:'Fast requested'})
    expect((screen.getByTestId('fast-chip') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('fast-chip'))
    expect(api.data.write).toHaveBeenCalledTimes(1)
    reopened.rerender(<Control api={api} sessionId="b" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'})
  })
  it.each(['default','unknown','unsupported','effective'])('reports %s as an observation distinct from the request',async(status)=>{
    const {api,files}=fixture()
    const path='.pi/agent/openai-fast/a_openai-codex_gpt-6%2E1-sol.json'
    files.set(path,JSON.stringify({version:1,enabled:true,revision:'r'}))
    files.set(path+'.status.json',JSON.stringify({model:'openai-codex/gpt-6.1-sol',revision:'r',requested:true,status,effectiveTier:status==='default'?'default':status==='effective'?'priority':null}))
    render(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    const suffix=status==='default'?'standard':status==='unknown'?'unconfirmed':status
    await screen.findByRole('button',{name:'Fast '+suffix})
    expect(screen.getByTestId('fast-chip').getAttribute('aria-pressed')).toBe('true')
  })
  it('disables mismatched APIs with a reason and discards a prior preference revision',async()=>{
    const {api,files}=fixture()
    const path='.pi/agent/openai-fast/a_openai-codex_gpt-6%2E1-sol.json'
    files.set(path,JSON.stringify({version:1,enabled:true,revision:'new'}))
    files.set(path+'.status.json',JSON.stringify({model:'openai-codex/gpt-6.1-sol',revision:'old',status:'effective',effectiveTier:'priority'}))
    const view=render(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast requested'})
    view.rerender(<Control api={api} sessionId="a" model={{...codex,api:'unsupported'}} disabled={false}/>)
    expect((screen.getByTestId('fast-chip') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('fast-chip').title).toContain('does not support')
  })
  it('keeps stale observation and write failures from claiming Fast, with a dismissible error',async()=>{
    const {api}=fixture()
    api.data.write.mockRejectedValueOnce(Error('offline'))
    render(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'})
    fireEvent.click(screen.getByTestId('fast-chip'))
    await screen.findByRole('alert')
    expect(screen.getByTestId('fast-chip').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button',{name:'Dismiss Fast error'}))
    await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull())
  })
})

function deferred<T = any>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {resolve=done})
  return {promise,resolve}
}
function capturePoll() {
  let poll!: () => Promise<void>
  const original=globalThis.setInterval
  vi.spyOn(globalThis,'setInterval').mockImplementation(((fn:any,delay:any,...args:any[])=>{
    if(delay===1500) poll=fn
    return original(fn,delay,...args)
  }) as any)
  return () => poll()
}
describe('Fast polling interleavings',()=>{
  it('does not allow a poll started during a pending write to undo persisted on, and the next click writes off',async()=>{
    const {api,files}=fixture(), poll=capturePoll(), written=deferred(), observed=deferred()
    const originalWrite=api.data.write.getMockImplementation()!
    api.data.write.mockImplementationOnce(async(path,content)=>{await written.promise;return originalWrite(path,content)})
    render(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'})
    const originalRead=api.data.read.getMockImplementation()!
    api.data.read.mockImplementation(async(path)=>path.endsWith('.status.json')?observed.promise:originalRead(path))
    fireEvent.click(screen.getByTestId('fast-chip'))
    const pendingPoll=poll()
    await act(async()=>{await Promise.resolve()})
    await act(async()=>written.resolve(undefined))
    await screen.findByRole('button',{name:'Fast requested'})
    await act(async()=>{observed.resolve({content:'',bytes:0,truncated:false});await pendingPoll})
    expect(screen.getByTestId('fast-chip').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('fast-chip'))
    await screen.findByRole('button',{name:'Fast off'})
    expect(JSON.parse([...files.values()][0]).enabled).toBe(false)
    expect(api.data.write).toHaveBeenCalledTimes(2)
  })
  it('keeps the latest refresh when an older observation completes last',async()=>{
    const {api,files}=fixture(),poll=capturePoll(),older=deferred()
    const path='.pi/agent/openai-fast/a_openai-codex_gpt-6%2E1-sol.json'
    render(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'})
    api.data.read.mockImplementationOnce(async()=>({content:'',bytes:0,truncated:false}))
      .mockImplementationOnce(async()=>older.promise)
    const first=poll(); await act(async()=>{await Promise.resolve()})
    files.set(path,JSON.stringify({version:1,enabled:true,revision:'external'}))
    await act(async()=>{await poll()})
    await screen.findByRole('button',{name:'Fast requested'})
    await act(async()=>{older.resolve({content:'',bytes:0,truncated:false});await first})
    expect(screen.getByTestId('fast-chip').getAttribute('aria-pressed')).toBe('true')
  })
  it('isolates a delayed write from a model switch and permits the new model choice',async()=>{
    const {api,files}=fixture(),written=deferred()
    const original=api.data.write.getMockImplementation()!
    api.data.write.mockImplementationOnce(async(path,content)=>{await written.promise;return original(path,content)})
    const view=render(<Control api={api} sessionId="a" model={codex} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'});fireEvent.click(screen.getByTestId('fast-chip'))
    view.rerender(<Control api={api} sessionId="a" model={flap} disabled={false}/>)
    await screen.findByRole('button',{name:'Fast off'});fireEvent.click(screen.getByTestId('fast-chip'))
    await screen.findByRole('button',{name:'Fast requested'})
    await act(async()=>written.resolve(undefined))
    expect(screen.getByTestId('fast-chip').getAttribute('aria-pressed')).toBe('true')
    expect([...files.values()].map(value=>JSON.parse(value).enabled)).toEqual([true,true])
    view.rerender(<Control api={api} sessionId="a" model={{provider:'anthropic',id:'claude'}} disabled={false}/>)
    expect(screen.queryByTestId('fast-chip')).toBeNull()
  })
})

it('keeps Fast off and disabled before a session identity exists, without data calls or a render crash',async()=>{
  const {api}=fixture()
  const view=render(<Control api={api} sessionId="" model={codex} disabled={false}/>)
  await screen.findByRole('button',{name:'Fast off'})
  expect((screen.getByTestId('fast-chip') as HTMLButtonElement).disabled).toBe(true)
  expect(api.data.read).not.toHaveBeenCalled();expect(api.data.write).not.toHaveBeenCalled()
  view.rerender(<Control api={api} sessionId="new-session" model={codex} disabled={false}/>)
  await waitFor(()=>expect((screen.getByTestId('fast-chip') as HTMLButtonElement).disabled).toBe(false))
  expect(screen.getByTestId('fast-chip').getAttribute('aria-pressed')).toBe('false')
})
