import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zstdDecompressSync} from 'node:zlib';
import openaiFast from '../agent/index.js';
import {capable, visible, preferencePath, requestPayload, parsePreference, observationStatus, estimatedUsage} from '../shared/policy.js';

const codex={provider:'openai-codex',id:'gpt-6.1-sol',api:'openai-codex-responses',baseUrl:'https://mock.invalid',
  reasoning:true,input:['text'],contextWindow:128000,maxTokens:8192,thinkingLevelMap:{low:'low'},
  cost:{input:2,output:8,cacheRead:0.2,cacheWrite:0}};
const flap={...codex,provider:'flapcode',api:'openai-responses',samplingParams:{service_tier:'fast'}};
const payload={model:codex.id,reasoning:{effort:'low'},service_tier:'fast'};
function fixture(model=codex) {
  const root=mkdtempSync(join(tmpdir(),'openai-fast-offline-'));
  const old={root:process.env.PIPIUI_PROJECT_ROOT,sid:process.env.PIPIUI_SESSION_ID};
  process.env.PIPIUI_PROJECT_ROOT=root;process.env.PIPIUI_SESSION_ID='session-a';
  const handlers={};openaiFast({on:(name,fn)=>handlers[name]=fn});
  const preference=enabled=>{
    const file=join(root,preferencePath('session-a',model));mkdirSync(dirname(file),{recursive:true});
    writeFileSync(file,JSON.stringify({version:1,enabled,revision:enabled?'on':'off'}));
  };
  return {root,handlers,preference,cleanup(){rmSync(root,{recursive:true,force:true});
    if(old.root===undefined)delete process.env.PIPIUI_PROJECT_ROOT;else process.env.PIPIUI_PROJECT_ROOT=old.root;
    if(old.sid===undefined)delete process.env.PIPIUI_SESSION_ID;else process.env.PIPIUI_SESSION_ID=old.sid;}};
}
test('capabilities show Codex and explicit Flapcode OpenAI identities only',()=>{
  assert.equal(visible(codex),true);assert.equal(visible(flap),true);
  assert.equal(visible({...flap,id:'claude-fast'}),false);
  assert.equal(visible({...codex,provider:'openai'}),false);
  assert.equal(capable({...codex,api:'other'}),false);
});
test('on overrides samplingParams; off forces default; unrelated provider and effort are unchanged',()=>{
  for(const model of [codex,flap]) {
    assert.equal(requestPayload(payload,model,true).service_tier,'priority');
    assert.equal(requestPayload(payload,model,false).service_tier,'default');
    assert.equal(requestPayload(payload,model,true).reasoning.effort,'low');
  }
  assert.equal(requestPayload(payload,{...flap,id:'claude'},true),payload);
  assert.equal(requestPayload(payload,{...codex,provider:'anthropic'},true),payload);
  assert.equal(requestPayload({...payload,model:'other'},codex,true).service_tier,'fast');
});
test('missing is off, malformed preference is invalid, identities cannot escape',()=>{
  assert.equal(parsePreference('').enabled,false);
  assert.throws(()=>parsePreference('{"enabled":true}'));
  assert.throws(()=>preferencePath('../session',codex));
  assert.notEqual(preferencePath('a',codex),preferencePath('a',flap));
  assert.notEqual(preferencePath('a',codex),preferencePath('b',codex));
});
for(const model of [codex,flap]) test(`${model.provider}: model/session isolation, restart and captured in-flight boundary`,()=>{
  const f=fixture(model);
  try {
    const hook=f.handlers.before_provider_request;
    assert.equal(hook({payload},{model}).service_tier,'default');
    f.preference(true);
    const captured=hook({payload},{model});assert.equal(captured.service_tier,'priority');
    f.preference(false);assert.equal(captured.service_tier,'priority');
    assert.equal(hook({payload},{model}).service_tier,'default');
    f.preference(true);
    const restarted={};openaiFast({on:(n,fn)=>restarted[n]=fn});
    assert.equal(restarted.before_provider_request({payload},{model}).service_tier,'priority');
    const other={...model,id:'gpt-6-sol'};
    assert.equal(hook({payload:{...payload,model:other.id}},{model:other}).service_tier,'default');
    const otherProvider=model.provider==='flapcode'?codex:flap;
    assert.equal(hook({payload},{model:otherProvider}).service_tier,'default');
    process.env.PIPIUI_SESSION_ID='session-b';
    const newSession={};openaiFast({on:(n,fn)=>newSession[n]=fn});
    assert.equal(newSession.before_provider_request({payload},{model}).service_tier,'default');
  } finally {f.cleanup();}
});
for(const tier of ['default','priority','fast',null]) test(`actual response ${tier}: display and persisted cost respect response, never requested tier`,()=>{
  const f=fixture();
  try {
    f.preference(true);f.handlers.before_provider_request({payload},{model:codex});
    f.handlers.provider_stream_event({provider:codex.provider,model:codex.id,data:{type:'response.completed',response:{service_tier:tier}}});
    const message={role:'assistant',provider:codex.provider,model:codex.id,content:[],usage:{input:10,output:5,cacheRead:2,cacheWrite:0,cost:{total:123}}};
    const result=f.handlers.message_end({message}).message;
    assert.equal(result.fastMode.effectiveTier,tier);
    assert.equal(result.fastMode.status,observationStatus(true,tier));
    if(tier)assert.ok(Math.abs(result.usage.cost.total-(10*2+5*8+2*0.2)/1e6*(tier==='default'?1:2))<1e-15);
    else assert.equal(result.usage,message.usage);
    const observed=JSON.parse(readFileSync(join(f.root,preferencePath('session-a',codex)+'.status.json'),'utf8'));
    assert.equal(observed.effectiveTier,tier);assert.equal(observed.requested,true);
  } finally {f.cleanup();}
});
test('unsupported response is metadata, no automatic downgrade/retry and no request-name substitution',()=>{
  const f=fixture();
  try {
    f.preference(true);f.handlers.before_provider_request({payload},{model:codex});
    const result=f.handlers.message_end({message:{role:'assistant',provider:codex.provider,model:codex.id,
      content:[],errorMessage:'Unsupported service_tier: priority',usage:{cost:{total:0}}}}).message;
    assert.equal(result.fastMode.status,'unsupported');assert.equal(result.fastMode.effectiveTier,null);
    assert.equal(result.model,codex.id);
  } finally {f.cleanup();}
});

// SDK transport contracts use only synthetic auth and events. Network is also denied by the test command's OS sandbox.
if(process.env.FAST_SDK_ROOT) {
  const adapters = {
    'openai-codex': await import(pathToFileURL(join(process.env.FAST_SDK_ROOT,'@earendil-works/pi-ai/dist/api/openai-codex-responses.js'))),
    flapcode: await import(pathToFileURL(join(process.env.FAST_SDK_ROOT,'@earendil-works/pi-ai/dist/api/openai-responses.js'))),
  };
  const syntheticJwt='x.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'mock-account'}})).toString('base64url')+'.x';
  for(const [model,transports] of [[codex,['sse','websocket']],[flap,['sse']]])
  for(const transport of transports) for(const enabled of [true,false])
  test(`${model.provider} pinned SDK ${transport}: ${enabled?'on':'off'} passes hook to serialized wire and actual default to message-end`,async()=>{
    const f=fixture(model),originalWs=globalThis.WebSocket,originalFetch=globalThis.fetch;
    const wires=[];
    const events=[{type:'response.completed',response:{id:'mock-response',status:'completed',output:[],service_tier:'default',
      usage:{input_tokens:11,output_tokens:5,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}];
    const fetch=async(_url,init)=>{
      const body=typeof init.body==='string'?init.body:zstdDecompressSync(init.body).toString();
      wires.push(JSON.parse(body));
      return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{status:200,headers:{'content-type':'text/event-stream'}});
    };
    class Socket extends EventTarget {
      readyState=0;static OPEN=1;static CLOSED=3;
      constructor(){super();queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
      send(body){wires.push(JSON.parse(body));queueMicrotask(()=>events.forEach(e=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(e)}))));}
      close(){this.readyState=3;}
    }
    globalThis.WebSocket=Socket;
    globalThis.fetch=()=>{throw Error('Unmocked fetch forbidden');};
    try {
      f.preference(enabled);
      const context={systemPrompt:'Synthetic offline contract',messages:[{role:'user',content:[{type:'text',text:'test'}],timestamp:0}]};
      const stream=adapters[model.provider].streamSimple(model,context,{apiKey:model.provider==='flapcode'?'mock-key':syntheticJwt,
        reasoning:'low',transport,fetch,maxRetries:0,timeoutMs:2000,websocketConnectTimeoutMs:1000,env:{},
        onPayload:body=>f.handlers.before_provider_request({payload:body},{model}),
        onProviderStreamEvent:data=>f.handlers.provider_stream_event({provider:model.provider,model:model.id,data})});
      const result=await stream.result();
      assert.notEqual(result.stopReason,'error',result.errorMessage);
      assert.equal(wires.length,1);assert.equal(wires[0].service_tier,enabled?'priority':'default');
      assert.equal(wires[0].reasoning.effort,'low');
      const final=f.handlers.message_end({message:result}).message;
      assert.equal(final.fastMode.effectiveTier,'default');
      assert.equal(final.fastMode.status,enabled?'default':'standard');
      assert.ok(Math.abs(final.usage.cost.total-(11*2+5*8)/1e6)<1e-15);
    } finally {globalThis.WebSocket=originalWs;globalThis.fetch=originalFetch;f.cleanup();}
  });
}

test('nonterminal tier cannot confirm Fast; a new turn cannot reuse a prior observation',()=>{
  const f=fixture();
  try {
    f.preference(true);f.handlers.before_provider_request({payload},{model:codex});
    f.handlers.provider_stream_event({provider:codex.provider,model:codex.id,data:{type:'response.created',response:{service_tier:'priority'}}});
    const message={role:'assistant',provider:codex.provider,model:codex.id,content:[],usage:{cost:{total:0}}};
    assert.equal(f.handlers.message_end({message}).message.fastMode.status,'unknown');
    assert.equal(f.handlers.message_end({message}),undefined);
    f.handlers.before_provider_request({payload},{model:codex});
    f.handlers.turn_start();
    assert.equal(f.handlers.message_end({message}),undefined);
  }finally{f.cleanup();}
});

if(process.env.FAST_SDK_ROOT) {
  const module = async path => import(pathToFileURL(join(process.env.FAST_SDK_ROOT,'@earendil-works/pi-coding-agent/dist/core',path)));
  const [{createAgentSession},{SessionManager},{SettingsManager},{createExtensionRuntime,loadExtensionFromFactory},{createEventBus}] = await Promise.all([
    module('sdk.js'),module('session-manager.js'),module('settings-manager.js'),module('extensions/loader.js'),module('event-bus.js')]);
  for(const model of [codex,flap]) test(`${model.provider}: real Pi SDK/AgentSession hooks and persisted message honor requested priority versus actual default`,async()=>{
    const f=fixture(model),wires=[];
    let session;
    try {
      f.preference(true);
      const runtime=createExtensionRuntime();
      const extension=await loadExtensionFromFactory(openaiFast,f.root,createEventBus(),runtime,'synthetic-openai-fast');
      const extensions={extensions:[extension],runtime,errors:[],warnings:[]};
      const empty=()=>({skills:[],prompts:[],themes:[],agentsFiles:[],diagnostics:[]});
      const resourceLoader={getExtensions:()=>extensions,getSkills:empty,getPrompts:empty,getThemes:empty,getAgentsFiles:empty,
        getSystemPrompt:()=> 'Synthetic offline contract',getAppendSystemPrompt:()=>[],getSystemPromptSource:()=>undefined,
        getAppendSystemPromptSources:()=>[],extendResources:()=>{},reload:async()=>{}};
      const syntheticJwt='x.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'mock-account'}})).toString('base64url')+'.x';
      const apiKey=model.provider==='flapcode'?'mock-key':syntheticJwt;
      const adapter=await import(pathToFileURL(join(process.env.FAST_SDK_ROOT,'@earendil-works/pi-ai/dist/api',model.provider==='flapcode'?'openai-responses.js':'openai-codex-responses.js')));
      const fetch=async(_url,init)=>{
        const body=typeof init.body==='string'?init.body:zstdDecompressSync(init.body).toString();wires.push(JSON.parse(body));
        const event={type:'response.completed',response:{id:'mock-response',status:'completed',output:[],service_tier:'default',usage:{input_tokens:11,output_tokens:5,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}};
        return new Response('data: '+JSON.stringify(event)+'\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
      };
      // Full session lifecycle is real; model/auth runtime is synthetic and never accesses credential files.
      const modelRuntime={getModel:()=>model,getPhysicalModel:()=>model,getModels:()=>[model],getAvailableSnapshot:()=>[model],
        getError:()=>undefined,hasConfiguredAuth:()=>true,isUsingOAuth:()=>false,isUsingSubscription:()=>false,
        getAuth:async()=>({auth:{apiKey},env:{}}),getCompatibilityRequestConfig:()=>({headers:{},authHeader:false}),
        streamSimple:(m,ctx,options)=>adapter.streamSimple(m,ctx,{...options,fetch,apiKey,transport:'sse',maxRetries:0,env:{}})};
      const manager=SessionManager.inMemory(f.root);
      ({session}=await createAgentSession({cwd:f.root,agentDir:join(f.root,'synthetic-agent'),model,thinkingLevel:'low',tools:[],
        sessionManager:manager,settingsManager:SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:'off',transport:'sse'}),
        resourceLoader,modelRuntime}));
      await session.bindExtensions({onError:error=>{throw Error(error.error)}});
      const visible=[];session.subscribe(event=>{if(event.type==='message_end'&&event.message.role==='assistant')visible.push({...event.message});});
      await session.prompt('Synthetic offline payload', {expandPromptTemplates:false});
      assert.equal(wires.length,1);assert.equal(wires[0].service_tier,'priority');assert.equal(wires[0].reasoning.effort,'low');
      const persisted=manager.getEntries().findLast(entry=>entry.type==='message'&&entry.message.role==='assistant').message;
      assert.equal(visible.length,1);assert.equal(visible[0].fastMode.status,'default');
      assert.equal(persisted.fastMode.effectiveTier,'default');assert.equal(persisted.fastMode.requested,true);
      assert.ok(Math.abs(persisted.usage.cost.total-(11*2+5*8)/1e6)<1e-15);
    }finally{session?.dispose();f.cleanup();}
  });
}

if(process.env.FAST_SDK_ROOT)for(const model of [codex,flap])test(`${model.provider}: rejected priority is unsupported with one mocked HTTP attempt`,async()=>{
  const f=fixture(model),wires=[];
  try {
    f.preference(true);
    const adapter=await import(pathToFileURL(join(process.env.FAST_SDK_ROOT,'@earendil-works/pi-ai/dist/api',model.provider==='flapcode'?'openai-responses.js':'openai-codex-responses.js')));
    const jwt='x.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'mock-account'}})).toString('base64url')+'.x';
    const fetch=async(_url,init)=>{const body=typeof init.body==='string'?init.body:zstdDecompressSync(init.body).toString();wires.push(JSON.parse(body));return new Response(JSON.stringify({error:{message:'Unsupported service_tier: priority',type:'invalid_request_error'}}),{status:400,headers:{'content-type':'application/json'}})};
    const result=await adapter.streamSimple(model,{messages:[{role:'user',content:'synthetic',timestamp:0}]},{apiKey:model.provider==='flapcode'?'mock-key':jwt,fetch,transport:'sse',maxRetries:0,env:{},onPayload:body=>f.handlers.before_provider_request({payload:body},{model})}).result();
    assert.equal(wires.length,1);assert.equal(wires[0].service_tier,'priority');assert.equal(result.stopReason,'error');
    assert.equal(f.handlers.message_end({message:result}).message.fastMode.status,'unsupported');
  }finally{f.cleanup();}
});


if(process.env.FAST_SDK_ROOT) for(const provider of ['openai-codex','flapcode'])
for(const terminalType of provider==='openai-codex'?['response.completed','response.done']:['response.completed'])
for(const tier of ['priority','fast','default']) test(`${provider} GPT-5.5 ${terminalType} actual ${tier}: model-specific estimate and terminal metadata`,async()=>{
  const model={...(provider==='flapcode'?flap:codex),id:'gpt-5.5'},f=fixture(model),wires=[];
  try {
    f.preference(true);
    const adapter=await import(pathToFileURL(join(process.env.FAST_SDK_ROOT,'@earendil-works/pi-ai/dist/api',provider==='flapcode'?'openai-responses.js':'openai-codex-responses.js')));
    const jwt='x.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'mock-account'}})).toString('base64url')+'.x';
    const fetch=async(_url,init)=>{
      wires.push(JSON.parse(typeof init.body==='string'?init.body:zstdDecompressSync(init.body).toString()));
      const event={type:terminalType,response:{id:'synthetic-response',status:'completed',output:[],service_tier:tier,
        usage:{input_tokens:11,output_tokens:5,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}};
      return new Response('data: '+JSON.stringify(event)+'\n\n',{status:200,headers:{'content-type':'text/event-stream'}});
    };
    const result=await adapter.streamSimple(model,{messages:[{role:'user',content:'synthetic',timestamp:0}]},{
      apiKey:provider==='flapcode'?'mock-key':jwt,fetch,transport:'sse',maxRetries:0,env:{},
      onPayload:payload=>f.handlers.before_provider_request({payload},{model}),
      onProviderStreamEvent:data=>f.handlers.provider_stream_event({provider,model:model.id,data})}).result();
    assert.notEqual(result.stopReason,'error',result.errorMessage);
    assert.equal(wires.length,1);assert.equal(wires[0].service_tier,'priority');
    const final=f.handlers.message_end({message:result}).message;
    assert.equal(final.fastMode.effectiveTier,tier);
    assert.equal(final.fastMode.status,tier==='default'?'default':'effective');
    const standard=(11*2+5*8)/1e6;
    assert.ok(Math.abs(final.usage.cost.total-standard*(tier==='default'?1:2.5))<1e-15);
    if(tier==='priority')assert.ok(Math.abs(final.usage.cost.total-result.usage.cost.total)<1e-15);
    if(tier!=='default')assert.equal(final.fastMode.costBasis,'reported-tier-pinned-sdk-estimate-price-unverified');
    const observed=JSON.parse(readFileSync(join(f.root,preferencePath('session-a',model)+'.status.json'),'utf8'));
    assert.equal(observed.effectiveTier,tier);assert.equal(observed.costBasis,final.fastMode.costBasis);
  }finally{f.cleanup();}
});
