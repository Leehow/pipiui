import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { transform } from "esbuild";
import { replaceConfinedDataFile } from "../src/extension-data-write.js";
import { createExtensionLoader } from "../src/extension-loader.js";
import { createExtensionRegistry } from "../src/extension-registry.js";

const fault = vi.hoisted(() => ({ uuid: null as string | null, afterWrite: null as (() => void) | null, failWrite: false }));
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: () => fault.uuid ?? actual.randomUUID() };
});
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
    if (fault.failWrite) throw new Error("injected write failure");
    actual.writeFileSync(...args);
    const callback = fault.afterWrite; fault.afterWrite = null; callback?.();
  } };
});
let root = "";
afterEach(() => {
  fault.uuid = null; fault.afterWrite = null; fault.failWrite = false;
  if (root) fs.rmSync(root, { recursive: true, force: true }); root = "";
});
function fixture() {
  root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "extension-safe-write-")));
  const project = join(root, "project"), parent = join(project, "requests");
  fs.mkdirSync(parent, { recursive: true });
  const outside = join(root, "outside"); fs.mkdirSync(outside);
  const target = join(parent, "choice.json");
  return { project, parent, outside, target };
}
function loader(project: string) {
  const ext = join(project, ".pi/agent/extensions/probe"); fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(join(ext, "pipiui-extension.json"), JSON.stringify({id:"probe",name:"Probe",version:"1.0.0",
    capabilities:["data.write"], app:{data:{write:["requests"]}}}));
  const instance = createExtensionLoader({registry:createExtensionRegistry(),appRoot:join(root,"app-extensions")});
  instance.scan(project); return instance;
}
describe("confined data replacement regression", () => {
  it("does not follow or remove the legacy predictable temporary symlink through the real loader", () => {
    const {project, target, outside} = fixture(); const instance = loader(project);
    const sentinel = join(outside, "sentinel"); fs.writeFileSync(sentinel,"untouched");
    const legacy = `${target}.${process.pid}.tmp`; fs.symlinkSync(sentinel,legacy);
    instance.writeDataFile("probe",project,"requests/choice.json","new");
    expect(fs.readFileSync(sentinel,"utf8")).toBe("untouched");
    expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(target).isFile()).toBe(true);
    expect(fs.readFileSync(target,"utf8")).toBe("new");
    expect(() => instance.writeDataFile("probe",project,"requests/../secret","bad")).toThrow();
    expect(() => instance.writeDataFile("probe",project,"elsewhere/file","bad")).toThrow();
  });
  it.each(["symlink", "regular"])("exclusive creation rejects a %s collision without deleting it", kind => {
    const {project,target,outside} = fixture(); fault.uuid = "collision";
    const temp = `${target}.${process.pid}.collision.tmp`, sentinel = join(outside,"sentinel");
    fs.writeFileSync(sentinel,"untouched");
    if (kind === "symlink") fs.symlinkSync(sentinel,temp); else fs.writeFileSync(temp,"occupied");
    expect(() => replaceConfinedDataFile(project,target,"bad")).toThrow();
    expect(fs.readFileSync(sentinel,"utf8")).toBe("untouched");
    expect(fs.lstatSync(temp).isSymbolicLink()).toBe(kind === "symlink");
    if (kind === "regular") expect(fs.readFileSync(temp,"utf8")).toBe("occupied");
    expect(fs.existsSync(target)).toBe(false);
  });
  it("preserves existing permissions and gives a new request private permissions", () => {
    const {project,target} = fixture();
    replaceConfinedDataFile(project,target,"first"); expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    fs.chmodSync(target,0o640); replaceConfinedDataFile(project,target,"second");
    expect(fs.statSync(target).mode & 0o777).toBe(0o640);
  });
  it("rejects an outside target, symlinked parent, and symlinked destination", () => {
    const {project,parent,target,outside} = fixture(); const sentinel = join(outside,"sentinel");
    fs.writeFileSync(sentinel,"untouched");
    expect(() => replaceConfinedDataFile(project,sentinel,"bad")).toThrow();
    fs.symlinkSync(sentinel,target); expect(() => replaceConfinedDataFile(project,target,"bad")).toThrow();
    fs.unlinkSync(target); fs.renameSync(parent,parent+"-old"); fs.symlinkSync(outside,parent);
    expect(() => replaceConfinedDataFile(project,target,"bad")).toThrow();
    expect(fs.readFileSync(sentinel,"utf8")).toBe("untouched");
  });
  it("aborts when the parent is swapped after the descriptor write without cleaning a foreign pathname", () => {
    const {project,parent,target,outside} = fixture(); fault.uuid="swap";
    fs.writeFileSync(join(outside,"choice.json"),"untouched");
    const foreign = join(outside,`choice.json.${process.pid}.swap.tmp`); fs.writeFileSync(foreign,"foreign");
    fault.afterWrite=()=>{fs.renameSync(parent,parent+"-displaced");fs.symlinkSync(outside,parent)};
    expect(() => replaceConfinedDataFile(project,target,"bad")).toThrow(/directory changed/);
    expect(fs.readFileSync(join(outside,"choice.json"),"utf8")).toBe("untouched");
    expect(fs.readFileSync(foreign,"utf8")).toBe("foreign");
  });
  it("rejects a destination changed to a symlink during the write and preserves its outside target", () => {
    const {project,target,outside} = fixture(); const sentinel=join(outside,"sentinel"); fs.writeFileSync(sentinel,"untouched");
    fault.afterWrite=()=>fs.symlinkSync(sentinel,target);
    expect(() => replaceConfinedDataFile(project,target,"bad")).toThrow(/regular file/);
    expect(fs.readFileSync(sentinel,"utf8")).toBe("untouched");
  });
  it("removes only its own temporary file on write failure", () => {
    const {project,parent,target} = fixture(); fault.failWrite=true;
    expect(() => replaceConfinedDataFile(project,target,"bad")).toThrow(/injected/);
    expect(fs.readdirSync(parent)).toEqual([]);
  });
  it("concurrent workers replace whole requests without temporary-file collisions", async () => {
    const {project,parent,target} = fixture();
    const source=fs.readFileSync(new URL("../src/extension-data-write.ts",import.meta.url),"utf8");
    const compiled=await transform(source,{loader:"ts",format:"esm",target:"es2022"});
    const moduleUrl="data:text/javascript;base64,"+Buffer.from(compiled.code).toString("base64");
    const values=Array.from({length:4},(_,i)=>String(i).repeat(30000));
    replaceConfinedDataFile(project,target,values[0]);
    const workers=values.map(value=>new Worker(`const {parentPort,workerData}=require('node:worker_threads');
      import(workerData.moduleUrl).then(({replaceConfinedDataFile:write})=>{
        parentPort.postMessage('ready');parentPort.once('message',()=>{for(let i=0;i<20;i++)write(workerData.project,workerData.target,workerData.value);parentPort.close()});
      }).catch(error=>{throw error});`,{eval:true,workerData:{moduleUrl,project,target,value}}));
    const done=workers.map(worker=>new Promise<void>((resolve,reject)=>{worker.on("error",reject);worker.on("exit",code=>code===0?resolve():reject(Error(`worker ${code}`)))}));
    await Promise.all(workers.map(worker=>new Promise<void>(resolve=>worker.once("message",()=>resolve()))));
    const reads:string[]=[]; const timer=setInterval(()=>reads.push(fs.readFileSync(target,"utf8")),1);
    workers.forEach(worker=>worker.postMessage("start"));
    try {await Promise.all(done)} finally {clearInterval(timer);await Promise.all(workers.map(worker=>worker.terminate()))}
    reads.push(fs.readFileSync(target,"utf8")); expect(reads.length).toBeGreaterThan(1);
    expect(reads.every(content=>values.includes(content))).toBe(true);
    expect(fs.readdirSync(parent)).toEqual(["choice.json"]);
  });
});
