const el = selector => document.querySelector(selector)
let ticket = location.hash.slice(1)
if (ticket) history.replaceState(null, '', location.pathname)
let register = Boolean(ticket)
let busy = false
async function request(path, data) {
  const res = await fetch('/mobile/' + path, data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {})
  const result = await res.json()
  if (!res.ok) throw Error(result.error || '连接失败')
  return result
}
function run(action) {
  return async event => {
    event?.preventDefault()
    if (busy) return
    busy = true
    try { await action() } catch (error) {
      el('aside span').textContent = error.message
      el('aside').hidden = false
    } finally { busy = false }
  }
}
function authMode() {
  el('#title').textContent = register ? '注册账号' : '登录 PipiUI'
  el('#submit').textContent = register ? '注册' : '登录'
  el('#switch').textContent = register ? '已有账号，登录' : '创建新账号'
  el('[name=password]').autocomplete = register ? 'new-password' : 'current-password'
}
async function display() {
  const {user,devices} = await request('me')
  el('#account').hidden = Boolean(user)
  el('#devices').hidden = !user
  authMode()
  if (!user) return
  el('#identity').textContent = user
  el('#bind').hidden = !ticket
  el('#list').replaceChildren()
  if (!devices.length && !ticket) el('#list').textContent = '请在电脑的 PipiUI 中启用手机支持，点击左下角手机图标绑定电脑。'
  for (const device of devices) {
    const row = document.createElement('article')
    const name = document.createElement('strong')
    name.textContent = device.name
    const connect = document.createElement('button')
    connect.textContent = device.online ? '连接电脑' : '电脑离线'
    connect.disabled = !device.online
    connect.onclick = run(async () => {
      await request('connect',{room:device.room})
      sessionStorage.removeItem('pipiui:remote-pair')
      location.assign('/')
    })
    const remove = document.createElement('button')
    remove.className = 'secondary'
    remove.textContent = '解除绑定'
    remove.onclick = run(async () => { if (confirm('解除这台电脑的绑定？')) { await request('unbind',{room:device.room}); await display() } })
    row.append(name,connect,remove)
    el('#list').append(row)
  }
}
el('aside button').onclick = () => { el('aside').hidden = true }
el('#switch').onclick = () => { register = !register; authMode() }
el('form').onsubmit = run(async () => {
  await request(register ? 'register' : 'login',Object.fromEntries(new FormData(el('form'))))
  el('form').reset()
  await display()
})
el('#bind').onclick = run(async () => { await request('bind',{ticket}); ticket = ''; await display() })
el('#logout').onclick = run(async () => { await request('logout',{}); await display() })
window.addEventListener('pageshow',run(display))

// A phone may already be signed in when its computer finishes binding.
let previousDevices
async function refreshDevices() {
  if (busy || document.hidden || el('#devices').hidden) return
  try {
    const state = await request('me')
    const signature = JSON.stringify(state)
    if (signature !== previousDevices) {
      previousDevices = signature
      await display()
    }
  } catch { /* Keep the current list during a temporary network interruption. */ }
}
setInterval(refreshDevices, 5000)
document.addEventListener('visibilitychange', refreshDevices)
