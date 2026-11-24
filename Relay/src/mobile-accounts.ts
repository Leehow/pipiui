import { DatabaseSync } from 'node:sqlite'
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { FixedWindowRateLimiter } from './limits.js'
import { cookieValue } from './host-api-v2.js'

const deriveKey = promisify(scrypt)
const cookie = '__Host-pipiui_account'
const lifetime = 30 * 86400
const token = () => randomBytes(32).toString('hex')
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
type Device = { room: string; fingerprint: string; name: string }
type Login = { user: string; selected: string | null; expires: number }
type LiveRoom = { host: unknown; hostTokenHash: Buffer }
class Failure extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function createMobileAccounts(path: string, origin: string, live: (id: string) => LiveRoom | undefined) {
  const db = new DatabaseSync(path)
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(user TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS logins(id TEXT PRIMARY KEY,user TEXT NOT NULL,selected TEXT,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS devices(room TEXT PRIMARY KEY,user TEXT NOT NULL,fingerprint TEXT NOT NULL,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,room TEXT NOT NULL,fingerprint TEXT NOT NULL,name TEXT NOT NULL,expires INTEGER NOT NULL);`)
  const attempts = new FixedWindowRateLimiter(600000, 30, 10000, Date.now)
  let pendingPasswords = 0
  const sockets = new Map<string, Set<() => void>>()
  const assets = new Map(['/mobile/', '/mobile/app.js','/mobile/style.css'].map((route, i) =>
    [route, readFileSync(new URL('../mobile-site/' + ['index.html','app.js','style.css'][i], import.meta.url))]))
  const loginId = (header?: string) => digest(cookieValue(header, cookie) || '')
  const session = (id: string) => db.prepare('SELECT user,selected,expires FROM logins WHERE id=? AND expires>?').get(id, Date.now()) as Login | undefined
  function active(device: Device | undefined) {
    if (!device) return false
    const room = live(device.room)
    return Boolean(room?.host && room.hostTokenHash.toString('hex') === device.fingerprint)
  }
  function selected(header?: string) {
    if (!cookieValue(header, cookie)) return
    const login = session(loginId(header))
    if (!login?.selected) return
    const device = db.prepare('SELECT * FROM devices WHERE user=? AND room=?').get(login.user,login.selected) as Device | undefined
    if (active(device)) return device!.room
  }
  function disconnect(id: string) { for (const close of sockets.get(id) || []) close() }
  function watch(header: string | undefined, close: () => void) {
    const id = loginId(header)
    const login = session(id)
    if (!login) return () => {}
    const set = sockets.get(id) || new Set()
    set.add(close)
    sockets.set(id,set)
    // Timers are capped at signed-int milliseconds in Node.
    function check() {
      const remaining = login!.expires - Date.now()
      if (remaining <= 0) close()
      else timer = setTimeout(check, Math.min(remaining, 2147483647)).unref()
    }
    let timer: NodeJS.Timeout
    check()
    return () => { clearTimeout(timer); set.delete(close); if (!set.size) sockets.delete(id) }
  }
  async function handle(req: IncomingMessage, res: ServerResponse, route: string) {
    res.setHeader('Cache-Control','no-store')
    res.setHeader('Referrer-Policy','no-referrer')
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'")
    const respond = (status: number, body: unknown) => {
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(body))
    }
    try {
      if (req.method === 'GET' && assets.has(route)) {
        res.setHeader('Content-Type',route.endsWith('.js') ? 'text/javascript' : route.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8')
        res.end(assets.get(route)); return
      }
      const id = loginId(req.headers.cookie)
      const login = session(id)
      if (route === '/mobile/me' && req.method === 'GET') {
        const devices = login ? db.prepare('SELECT room,name,fingerprint FROM devices WHERE user=? ORDER BY name').all(login.user) as Device[] : []
        respond(200,{user:login?.user, devices:devices.map(d => ({room:d.room,name:d.name,online:active(d)}))}); return
      }
      if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Failure(405,'请求方式无效')
      if (req.headers.origin !== origin && !(route === '/mobile/ticket' && !req.headers.origin)) throw new Failure(403,'来源无效')
      const parts: Buffer[] = []
      let size = 0
      for await (const part of req) { size += part.length; if (size > 4096) throw new Failure(413,'输入过长'); parts.push(part) }
      const data = JSON.parse(Buffer.concat(parts).toString())
      if (!data || typeof data !== 'object') throw new Failure(400,'输入无效')
      const now = Date.now()
      if (route === '/mobile/ticket') {
        const room = typeof data.room === 'string' ? live(data.room) : undefined
        if (!room?.host || typeof data.proof !== 'string' || !timingSafeEqual(room.hostTokenHash,Buffer.from(digest(data.proof),'hex'))) throw new Failure(409,'电脑尚未连接')
        const ticket = token()
        db.prepare('DELETE FROM tickets WHERE expires<=? OR room=?').run(now,data.room)
        db.prepare('INSERT INTO tickets VALUES(?,?,?,?,?)').run(digest(ticket),data.room,room.hostTokenHash.toString('hex'),String(data.name || 'PipiUI 电脑').slice(0,80),now+600000)
        respond(200,{ticket}); return
      }
      if (route === '/mobile/register' || route === '/mobile/login') {
        const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress)
        if (!attempts.take(ip)) throw new Failure(429,'尝试过于频繁，请稍后再试')
        const user = String(data.user || '').trim().toLowerCase()
        if (!/^[a-z0-9_.@-]{3,80}$/.test(user) || typeof data.password !== 'string' || data.password.length < 10 || data.password.length > 256) throw new Failure(400,'用户名需为 3–80 位字母、数字或 _.@-，密码需为 10–256 位')
        const register = route.endsWith('/register')
        const row = db.prepare('SELECT salt,hash FROM users WHERE user=?').get(user)
        const salt = !register && row ? String(row.salt) : token()
        if (pendingPasswords >= 8) throw new Failure(429,'服务繁忙，请稍后再试')
        pendingPasswords++
        let hash: Buffer
        try { hash = await deriveKey(data.password,salt,64) as Buffer }
        finally { pendingPasswords-- }
        if (register) {
          if (!db.prepare('INSERT OR IGNORE INTO users VALUES(?,?,?)').run(user,salt,hash.toString('hex')).changes) throw new Failure(409,'用户名已注册')
        } else if (!row || !timingSafeEqual(hash,Buffer.from(String(row.hash),'hex'))) throw new Failure(401,'用户名或密码错误')
        const key = token()
        db.prepare('DELETE FROM logins WHERE id=? OR expires<=?').run(id,now)
        disconnect(id)
        db.prepare('INSERT INTO logins VALUES(?,?,NULL,?)').run(digest(key),user,now+lifetime*1000)
        res.setHeader('Set-Cookie',cookie+'='+key+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+lifetime)
        respond(200,{}); return
      }
      if (!login) throw new Failure(401,'请先登录')
      if (route === '/mobile/bind') {
        const ticket = db.prepare('SELECT * FROM tickets WHERE id=? AND expires>?').get(digest(String(data.ticket)),now)
        if (!ticket || !active(ticket as Device)) throw new Failure(410,'绑定链接已失效，请再次点击桌面手机图标')
        const owner = db.prepare('SELECT user FROM devices WHERE room=? AND fingerprint=?').get(ticket.room,ticket.fingerprint)
        if (owner && owner.user !== login.user) throw new Failure(409,'这台电脑已绑定其他账号，请先解除绑定')
        db.exec('BEGIN')
        try {
          db.prepare('INSERT OR REPLACE INTO devices VALUES(?,?,?,?)').run(ticket.room,login.user,ticket.fingerprint,ticket.name)
          db.prepare('DELETE FROM tickets WHERE id=?').run(ticket.id)
          db.exec('COMMIT')
        } catch (e) { db.exec('ROLLBACK'); throw e }
      } else if (route === '/mobile/connect' || route === '/mobile/unbind') {
        const device = db.prepare('SELECT * FROM devices WHERE room=? AND user=?').get(String(data.room),login.user) as Device | undefined
        if (!device) throw new Failure(404,'未找到电脑')
        if (route.endsWith('/connect')) {
          if (!active(device)) throw new Failure(409,'电脑已离线')
          disconnect(id)
          db.prepare('UPDATE logins SET selected=? WHERE id=?').run(device.room,id)
          res.setHeader('Set-Cookie','pipiui_pair=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0')
        } else {
          db.prepare('DELETE FROM devices WHERE room=? AND user=?').run(device.room,login.user)
          for (const row of db.prepare('SELECT id FROM logins WHERE user=? AND selected=?').all(login.user,device.room)) disconnect(String(row.id))
          db.prepare('UPDATE logins SET selected=NULL WHERE user=? AND selected=?').run(login.user,device.room)
        }
      } else if (route === '/mobile/logout') {
        db.prepare('DELETE FROM logins WHERE id=?').run(id); disconnect(id)
        res.setHeader('Set-Cookie',cookie+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0')
      } else throw new Failure(404,'页面不存在')
      respond(200,{})
    } catch (e) {
      respond(e instanceof Failure ? e.status : e instanceof SyntaxError ? 400 : 500,{error:e instanceof Failure ? e.message : '暂时无法完成请求'})
    }
  }
  return {handle,selected,watch,close:() => db.close()}
}
