export const pageHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>PipiUI Remote</title>
<style nonce="{{NONCE}}">body{font:15px system-ui;margin:0;background:#f5f5f7;color:#1d1d1f}main{max-width:900px;margin:32px auto;padding:20px}section{background:white;border-radius:14px;padding:16px;margin:12px 0}button,select,textarea{font:inherit;padding:8px}textarea{width:100%;box-sizing:border-box}.msg{white-space:pre-wrap;border-top:1px solid #eee;padding:10px 0}.muted{color:#666}</style>
</head><body><main><h1>PipiUI Remote</h1><p id="status" class="muted">正在连接 Mac…</p>
<section><button id="refresh">刷新</button> <select id="projects"></select> <button id="create">新建会话</button><br><select id="sessions"></select> <button id="open">打开</button></section>
<section id="transcript"></section>
<section><textarea id="prompt" rows="4" placeholder="输入消息"></textarea><button id="send">发送</button> <button id="stop">Stop</button></section>
</main><script nonce="{{NONCE}}">
const csrf=document.cookie.split('; ').find(x=>x.startsWith('pipiui_csrf='))?.split('=')[1]||'';
const state={sessionID:null,revision:null,hostEpoch:null};
async function api(path,method='GET',body){const h={'Accept':'application/json'};if(method==='POST'){h['Content-Type']='application/json';h['X-PipiUI-CSRF']=csrf}const r=await fetch(path,{method,headers:h,body:body?JSON.stringify(body):undefined,credentials:'same-origin'});const epoch=r.headers.get('X-PipiUI-Host-Epoch');if(epoch&&state.hostEpoch&&epoch!==state.hostEpoch){state.sessionID=null;state.revision=null;document.querySelector('#transcript').textContent='Mac 已重启，请重新选择会话'}if(epoch)state.hostEpoch=epoch;if(!r.ok&&r.status!==304)throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status));return r.status===304?null:r.json()}
async function index(){try{const x=await api('/api/index');const p=document.querySelector('#projects');p.textContent='';for(const item of x.projects){const o=document.createElement('option');o.value=item.id;o.textContent=item.name;p.append(o)}const s=document.querySelector('#sessions');s.textContent='';for(const item of x.sessions){const o=document.createElement('option');o.value=item.id;o.textContent=item.title;s.append(o)}document.querySelector('#status').textContent='Mac 已在线'}catch(e){document.querySelector('#status').textContent=e.message}}
async function open(){state.sessionID=document.querySelector('#sessions').value;if(!state.sessionID)return;await api('/api/sessions/open','POST',{sessionID:state.sessionID});state.revision=null;poll()}
async function poll(){if(!state.sessionID)return;try{const x=await api('/api/snapshot','POST',{sessionID:state.sessionID,revision:state.revision});if(x){state.revision=x.revision;const t=document.querySelector('#transcript');t.textContent='';for(const m of x.snapshot.messages){const d=document.createElement('div');d.className='msg';d.textContent=m.kind==='thinking'?'[thinking]':m.kind==='tool'?('[tool] '+(m.toolName||'')+' '+(m.toolSummary||'')):m.text;t.append(d)}}}catch(e){document.querySelector('#status').textContent=e.message}setTimeout(poll,900)}
document.querySelector('#refresh').onclick=index;document.querySelector('#open').onclick=open;
document.querySelector('#create').onclick=async()=>{const projectID=document.querySelector('#projects').value;if(!projectID)return;const x=await api('/api/sessions','POST',{projectID});state.sessionID=x.sessionID;state.revision=null;await index();poll()};
document.querySelector('#send').onclick=async()=>{const text=document.querySelector('#prompt').value;if(!state.sessionID||!text)return;await api('/api/send','POST',{sessionID:state.sessionID,text,commandID:crypto.randomUUID()});document.querySelector('#prompt').value=''};
document.querySelector('#stop').onclick=()=>state.sessionID&&api('/api/stop','POST',{sessionID:state.sessionID});index();
</script></body></html>`;
