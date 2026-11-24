import {afterEach, expect, it} from 'vitest'
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {assemblePiSpawn} from '../src/spawn-assembly.js'
import {createExtensionLoader} from '../src/extension-loader.js'
import {createExtensionRegistry} from '../src/extension-registry.js'
import {validateExtensionManifest} from '../src/extension-manifest.js'
let root=''
afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});root=''})
const manifest={id:'openai-fast',name:'OpenAI Fast',version:'0.1.0',defaultEnabled:true,capabilities:['data.read','data.write'],
  app:{data:{read:['.pi/agent/openai-fast'],write:['.pi/agent/openai-fast']},ui:{composerActions:[{id:'openai-fast.toggle',entry:'app/control.js'}]}}}
it('validates the composer declaration and rejects invalid contribution entries',()=>{
  const result=validateExtensionManifest(manifest);expect(result.ok).toBe(true)
  if(result.ok)expect(result.manifest.ui?.composerActions?.[0].entry).toBe('app/control.js')
  expect(validateExtensionManifest({...manifest,app:{ui:{composerActions:[{id:'bad id',entry:'../outside.js'}]}}}).ok).toBe(false)
})
it('reads missing state as off without creating it; initializes only a declared writable root; preserves confinement',async()=>{
  root=await mkdtemp(join(tmpdir(),'fast-data-'))
  const project=join(root,'project'),pkg=join(project,'.pi/agent/extensions/openai-fast')
  await mkdir(pkg,{recursive:true});await writeFile(join(pkg,'pipiui-extension.json'),JSON.stringify(manifest))
  const loader=createExtensionLoader({registry:createExtensionRegistry(),appRoot:join(root,'app')});loader.scan(project)
  const path='.pi/agent/openai-fast/session_model.json'
  expect(loader.readDataFile('openai-fast',project,path,4096,true).content).toBe('')
  loader.writeDataFile('openai-fast',project,path,'{"enabled":true}')
  expect(loader.readDataFile('openai-fast',project,path,4096,true).content).toBe('{"enabled":true}')
  expect(()=>loader.writeDataFile('openai-fast',project,'outside/file.json','{}')).toThrow()
  expect(()=>loader.readDataFile('openai-fast',project,'../outside',4096,true)).toThrow()
  const target=join(root,'outside');await mkdir(target)
  await symlink(target,join(project,'.pi/agent/openai-fast/link'))
  expect(()=>loader.writeDataFile('openai-fast',project,'.pi/agent/openai-fast/link/leak.json','{}')).toThrow()
  expect(()=>loader.readDataFile('openai-fast',project,'.pi/agent/openai-fast/link/none.json',4096,true)).toThrow()
})

it('discovers the real plugin and mounts its agent half with canonical project/session identity',()=>{
  const appRoot=fileURLToPath(new URL('../../../resources/runtime/extensions/',import.meta.url))
  const registry=createExtensionRegistry();const loader=createExtensionLoader({registry,appRoot})
  loader.scan('/tmp/fast-synthetic-project')
  const mount=loader.spawnPackages().find(x=>x.id==='openai-fast')
  expect(mount?.enabled,JSON.stringify(registry.list().find(x=>x.id==='openai-fast'))).toBe(true)
  expect(mount?.extensionPath).toContain('/openai-fast/agent/index.js')
  const spawn=assemblePiSpawn({cwd:'/tmp/fast-workspace',projectRoot:'/tmp/fast-project',sessionId:'fast-session',paths:{},registeredExtensions:[mount!]})
  expect(spawn.args).toContain(mount!.extensionPath)
  expect(spawn.env.PIPIUI_PROJECT_ROOT).toBe('/tmp/fast-project')
  expect(spawn.env.PIPIUI_SESSION_ID).toBe('fast-session')
  const disabled=assemblePiSpawn({cwd:'/tmp/fast-workspace',paths:{},registeredExtensions:[{...mount!,enabled:false}]})
  expect(disabled.args).not.toContain(mount!.extensionPath)
})
