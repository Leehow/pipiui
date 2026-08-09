// PipiUI official local package. No runtime npm install; PDFs stay local.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn } from "node:child_process";
import { access, mkdtemp, open, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const API_GAP_MS = 3000, TOTAL_BUDGET_MS = 30000, MAX_PDF_BYTES = 50 * 1024 * 1024;
const OFFICIAL_PDF_HOSTS = new Set(["arxiv.org", "www.arxiv.org"]);
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
let lastAPIStart = 0;
const inflight = new Map<string, Promise<Paper>>(), cache = new Map<string, { until: number; value: Paper }>();
type Target = { id: string; version?: string; requested: "abs" | "html" | "pdf" };
type Paper = { id: string; resolved?: string; title: string; authors: string[]; summary: string; categories: string[]; primary?: string; published?: string; updated?: string; comment?: string; journal?: string; doi?: string; links: string[]; withdrawn: boolean };
function result(text: string, isError = false) { return { content: [{ type: "text" as const, text }], details: {}, ...(isError ? { isError: true } : {}) }; }
function trunc(s: string, n: number) { return s.length <= n ? s : s.slice(0, n - 15) + "\n\n[truncated]"; }
function decode(s: string) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&(amp|lt|gt|quot|apos|nbsp);|&#(x[0-9a-f]+|\d+);/gi, (_: string,n: string,x: string) => n ? ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "} as any)[n.toLowerCase()] : String.fromCodePoint(parseInt(x[0].toLowerCase()==="x"?x.slice(1):x, x[0].toLowerCase()==="x"?16:10))); }
function strip(s: string) { return decode(s.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()); }
function tag(xml: string, name: string) { return xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`,"i"))?.[1]; }
function attr(s: string, name: string) { return s.match(new RegExp(`${name}=["']([^"']+)["']`,"i"))?.[1]; }
function parseArxivURL(raw: string): Target {
  const u = new URL(raw); const host = u.hostname.toLowerCase();
  if (!["arxiv.org","www.arxiv.org","export.arxiv.org","ar5iv.labs.arxiv.org"].includes(host)) throw new Error("unsupported URL: use web_fetch for non-arXiv URLs.");
  const p = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (p.some(x => x === ".." || x.includes("\\") || x.includes("\0"))) throw new Error("unsupported unsafe arXiv URL.");
  let requested: Target["requested"], token: string | undefined;
  // Legacy identifiers retain their category slash (for example
  // /abs/hep-th/9901001v3), unlike the modern single-path-component form.
  const identifier = p.slice(1).join("/");
  if (host === "ar5iv.labs.arxiv.org" && p[0] === "html") { requested="html"; token=identifier; }
  else if (["abs","pdf","html"].includes(p[0] || "")) { requested=p[0] as Target["requested"]; token=identifier.replace(/\.pdf$/i,""); }
  else if (["src", "e-print", "ps", "dvi"].includes(p[0] || "")) throw new Error("unsupported arXiv src/e-print/ps/dvi URL: source archives are not fetched.");
  else throw new Error("unsupported arXiv URL: expected /abs, /html, or /pdf.");
  if (!token) throw new Error("unsupported arXiv paper URL.");
  const m = token.match(/^((?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7}))(v\d+)?$/i);
  if (!m) throw new Error("invalid arXiv identifier.");
  return { id: m[1].toLowerCase(), version: m[2], requested };
}
async function fetchText(url: string, deadline: number, accept = "text/html,application/xml;q=0.9,*/*;q=0.1") {
 const remain=deadline-Date.now(); if(remain<=0) throw new Error("shared 30s request budget exhausted"); const c=new AbortController(), t=setTimeout(()=>c.abort(),remain);
 try { const r=await fetch(url,{headers:{"User-Agent":"PipiUI-arxiv-fetch/0.1 (+local Pi package)",Accept:accept},signal:c.signal,redirect:"follow"}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r; } finally { clearTimeout(t); }
}
async function metadata(t: Target, deadline: number): Promise<Paper> {
 const key=t.id+(t.version||""); const cached=cache.get(key); if(cached && cached.until>Date.now()) return cached.value; if(inflight.has(key)) return inflight.get(key)!;
 const job=(async()=>{ const delay=Math.max(0,lastAPIStart+API_GAP_MS-Date.now()); if(delay) await new Promise(r=>setTimeout(r,delay)); lastAPIStart=Date.now();
  const r=await fetchText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(t.id+(t.version||""))}`,deadline,"application/atom+xml"); const xml=await r.text(); const e=tag(xml,"entry"); if(!e) throw new Error("arXiv Atom API returned no entry");
  const links=[...e.matchAll(/<link\b[^>]*>/gi)].map(x=>attr(x[0],"href")).filter(Boolean) as string[]; const cats=[...e.matchAll(/<category\b[^>]*>/gi)].map(x=>attr(x[0],"term")).filter(Boolean) as string[];
  const p:Paper={id:t.id,resolved:(tag(e,"id")?.match(/\/abs\/([^\s<]+)/)?.[1]),title:strip(tag(e,"title")||"Untitled"),authors:[...e.matchAll(/<author\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map(x=>strip(x[1])),summary:strip(tag(e,"summary")||""),categories:cats,primary:attr(e.match(/<arxiv:primary_category\b[^>]*>/i)?.[0]||"","term"),published:strip(tag(e,"published")||""),updated:strip(tag(e,"updated")||""),comment:strip(tag(e,"arxiv:comment")||""),journal:strip(tag(e,"arxiv:journal_ref")||""),doi:strip(tag(e,"arxiv:doi")||""),links,withdrawn:/withdrawn/i.test(strip(tag(e,"summary")||"") + " " + strip(tag(e,"title")||""))};
  cache.set(key,{value:p,until:Date.now()+(t.version?3600000:60000)}); return p;
 })(); inflight.set(key,job); try{return await job}finally{inflight.delete(key)}
}
function htmlMarkdown(raw:string) { const main=raw.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2]||raw; let s=main.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi,""); s=s.replace(/<math[^>]*alttext=["']([^"']+)["'][^>]*>[\s\S]*?<\/math>/gi," $1 ").replace(/<(h[1-6])[^>]*>/gi,(_,h)=>"\n\n"+"#".repeat(+h[1])+" ").replace(/<\/(p|div|section|figure|table|figcaption|caption|li|h[1-6])>/gi,"\n\n").replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,"$2 ($1)").replace(/<pre[^>]*>/gi,"\n```\n").replace(/<\/pre>/gi,"\n```\n"); return strip(s.replace(/\n/g," \n ")).replace(/ *\n */g,"\n").replace(/\n{3,}/g,"\n\n"); }
async function html(id:string, host:string, deadline:number) { const r=await fetchText(`${host}/html/${encodeURIComponent(id)}`,deadline); const s=htmlMarkdown(await r.text()); if(s.replace(/\s/g,"").length<160) throw new Error("HTML quality gate failed"); return s; }
function boundedPDFContentLength(r:any) {
 const raw=r.headers.get("content-length"); if(raw===null||raw.trim()==="") return undefined; const value=raw.trim();
 if(!/^\d+$/.test(value)) throw new Error("invalid PDF content-length"); const bytes=Number(value);
 if(!Number.isSafeInteger(bytes)) throw new Error("invalid PDF content-length"); if(bytes>MAX_PDF_BYTES) throw new Error("PDF exceeds 50 MB cap"); return bytes;
}
function validatePDFResponseURL(raw:string,id:string) {
 let u:URL; try { u=new URL(raw); } catch { throw new Error("final PDF URL is invalid"); }
 if(u.protocol!=="https:") throw new Error("final PDF URL must remain HTTPS");
 if(!OFFICIAL_PDF_HOSTS.has(u.hostname.toLowerCase())) throw new Error("final PDF URL host is not official arXiv");
 let parts:string[]; try { parts=u.pathname.split("/").filter(Boolean).map(part=>decodeURIComponent(part)); } catch { throw new Error("final PDF URL path is invalid"); }
 const token=parts.slice(1).join("/").replace(/\.pdf$/i,"");
 if(parts[0]!=="pdf"||token!==id) throw new Error("final PDF URL is not the requested official PDF");
}
function asPDFBytes(value:any) {
 if(value instanceof Uint8Array) return value;
 if(value instanceof ArrayBuffer) return new Uint8Array(value);
 if(ArrayBuffer.isView(value)) return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
 throw new Error("official PDF response returned an invalid chunk");
}
function appendPDFMagic(prefix:Uint8Array,bytes:Uint8Array) {
 if(prefix.length>=PDF_MAGIC.length||bytes.length===0) return prefix; const count=Math.min(PDF_MAGIC.length-prefix.length,bytes.length), next=new Uint8Array(prefix.length+count);
 next.set(prefix); next.set(bytes.subarray(0,count),prefix.length); return next;
}
function hasPDFMagic(prefix:Uint8Array) { return prefix.length===PDF_MAGIC.length&&PDF_MAGIC.every((byte,index)=>prefix[index]===byte); }
async function writePDFChunk(file:any,bytes:Uint8Array) {
 for(let offset=0;offset<bytes.byteLength;) { const {bytesWritten}=await file.write(bytes,offset,bytes.byteLength-offset,null); if(!bytesWritten) throw new Error("failed to write temporary PDF"); offset+=bytesWritten; }
}
async function abortPDFReader(reader:any,controller:any) { controller.abort(); try { await reader.cancel(); } catch {} }
async function pdf(id:string, deadline:number, max:number) {
 const helper=(process.env.PIPIUI_PDF_HELPER||"").trim(); if(!helper) throw new Error("local PDF helper unavailable (PIPIUI_PDF_HELPER is not set)"); await access(helper,constants.X_OK);
 const dir=await mkdtemp(join(tmpdir(),"pipiui-arxiv-")), path=join(dir,"paper.pdf"), controller=new AbortController(); let timer:any, file:any;
 try {
  const remain=deadline-Date.now(); if(remain<=0) throw new Error("shared 30s request budget exhausted"); timer=setTimeout(()=>controller.abort(),remain);
  const r=await fetch(`https://arxiv.org/pdf/${encodeURIComponent(id)}`,{headers:{"User-Agent":"PipiUI-arxiv-fetch/0.1 (+local Pi package)",Accept:"application/pdf,*/*;q=0.1"},signal:controller.signal,redirect:"follow"});
  if(!r.ok) throw new Error(`HTTP ${r.status}`); validatePDFResponseURL(r.url,id);
  if(!/^application\/(pdf|x-pdf|octet-stream)/i.test(r.headers.get("content-type")||"")) throw new Error("official PDF content-type is not PDF"); const contentLength=boundedPDFContentLength(r);
  file=await open(path,"wx"); let bytesRead=0, magic=new Uint8Array(0); const body=(r as any).body;
  if(body&&typeof body.getReader==="function") {
   const reader=body.getReader();
   try { for(;;) { const {done,value}=await reader.read(); if(done) break; const bytes=asPDFBytes(value), next=bytesRead+bytes.byteLength; if(next>MAX_PDF_BYTES) throw new Error("PDF exceeds 50 MB cap"); bytesRead=next; magic=appendPDFMagic(magic,bytes); await writePDFChunk(file,bytes); } }
   catch(error) { await abortPDFReader(reader,controller); throw error; }
   finally { try { reader.releaseLock?.(); } catch {} }
  } else {
   // A body-less Fetch response can only use its protocol-framed, bounded fallback; never aggregate an unknown-length response.
   if(contentLength===undefined) throw new Error("PDF response body is unavailable without a bounded content-length"); const read=(r as any).arrayBuffer;
   if(typeof read!=="function") throw new Error("PDF response body is unavailable"); const bytes=asPDFBytes(await read.call(r));
   if(bytes.byteLength>MAX_PDF_BYTES) throw new Error("PDF exceeds 50 MB cap"); bytesRead=bytes.byteLength; magic=appendPDFMagic(magic,bytes); await writePDFChunk(file,bytes);
  }
  if(!hasPDFMagic(magic)) throw new Error("official PDF failed %PDF validation"); await file.close(); file=undefined;
  return await new Promise<string>((resolve,reject)=>{const c=spawn(helper,[],{shell:false,stdio:["pipe","pipe","pipe"]});let out="",err="";const helperTimer=setTimeout(()=>c.kill("SIGTERM"),Math.max(1,deadline-Date.now()));c.stdout.on("data",x=>out+=x);c.stderr.on("data",x=>err+=x);c.on("error",reject);c.on("close",code=>{clearTimeout(helperTimer);try{const x=JSON.parse(out);if(code===0&&x.ok)resolve(trunc(String(x.markdown||""),max));else reject(new Error(x.error?.message||err||"PDF helper failed"));}catch{reject(new Error("PDF helper returned invalid JSON"));}});c.stdin.end(JSON.stringify({path,mode:"auto",max_length:max})+"\n");});
 } catch(error) { controller.abort(); throw error; }
 finally { if(timer) clearTimeout(timer); if(file) await file.close().catch(()=>{}); await rm(dir,{recursive:true,force:true}); }
}
function render(p:Paper, source:string, body:string, warning?:string, requestedVersion=p.id) { return [`# ${p.title}`,"",`paper_id: ${p.id}`,`requested_version: ${requestedVersion}`,`resolved_version: ${p.resolved||"unknown"}`,`authors: ${p.authors.join(", ")}`,`categories: ${p.categories.join(", ")}`,`primary_category: ${p.primary||""}`,`published: ${p.published||""}`,`updated: ${p.updated||""}`,`doi: ${p.doi||""}`,`journal_ref: ${p.journal||""}`,`links: ${p.links.join(" ")}`,`content_source: ${source}`,p.withdrawn?"> Warning: arXiv metadata indicates this paper may be withdrawn.":"",warning?`> Warning: ${warning}`:"","## Abstract","",p.summary,"","## Body","",body].filter(Boolean).join("\n"); }
export default function(pi:ExtensionAPI) { pi.registerTool({name:"arxiv_fetch",label:"arXiv Fetch",description:"Fetch arXiv paper metadata and readable content. Use for arxiv.org/export.arxiv.org/ar5iv URLs; use github_fetch for GitHub and web_fetch for other URLs.",promptSnippet:"Fetch an arXiv paper with metadata and local-only PDF fallback",promptGuidelines:["Route arXiv domains to arxiv_fetch; GitHub code URLs to github_fetch; all other sites to web_fetch.","Never use source/e-print routes; PDFs are downloaded only from normalized official arXiv PDF URLs and never uploaded."],parameters:Type.Object({url:Type.String(),max_length:Type.Optional(Type.Integer({minimum:1000,maximum:100000}))}),async execute(_id,params){const deadline=Date.now()+TOTAL_BUDGET_MS,max=Math.min(Math.max(Number(params.max_length||20000),1000),100000);try{const t=parseArxivURL(String(params.url||""));const p=await metadata(t,deadline);let body="",source="abstract-only",warning="";if(t.requested==="pdf"){try{body=await pdf(p.resolved||t.id,deadline,max);source="pdfkit";}catch(e:any){warning=`PDF unavailable: ${e.message}`;}}if(source==="abstract-only"){try{body=await html(p.resolved||t.id,"https://arxiv.org",deadline);source="arxiv-html";}catch(e:any){try{body=await html(p.resolved||t.id,"https://ar5iv.labs.arxiv.org",deadline);source="ar5iv";warning="ar5iv does not guarantee the requested version.";}catch{if(t.requested!=="pdf")try{body=await pdf(p.resolved||t.id,deadline,max);source="pdfkit";}catch{} }}}return result(trunc(render(p,source,body,warning,t.id+(t.version||"")),max));}catch(e:any){return result(`arxiv_fetch failed: ${e.message||e}`,true);}}}); }
