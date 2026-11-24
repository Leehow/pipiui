import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import WebSocket from 'ws'
import { createHostAPIRelay } from '../src/host-api-relay.js'

test('only the bound account can control its live desktop and logout closes its socket', async t => {
  const origin = 'https://remote.deepwood.cn'
  const previous = process.env.PIPIUI_MOBILE_DB
  process.env.PIPIUI_MOBILE_DB = ':memory:'
  const relay = createHostAPIRelay({ publicOrigin: origin })
  if (previous === undefined) delete process.env.PIPIUI_MOBILE_DB
  else process.env.PIPIUI_MOBILE_DB = previous
  const server = createServer((req, res) => {
    if (!relay.handleRequest(req, res, new URL(req.url!, origin))) {
      res.writeHead(404)
      res.end()
    }
  })
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head))
  server.listen(0, '127.0.0.1')
  t.after(async () => { await relay.close(); server.closeAllConnections(); server.close() })
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const root = 'http://127.0.0.1:' + address.port
  const post = (path: string, body: object, cookie = '', requestOrigin = origin) =>
    fetch(root + '/mobile/' + path, { method: 'POST', headers: {
      cookie, origin: requestOrigin, 'content-type': 'application/json',
    }, body: JSON.stringify(body) })
  const password = randomBytes(24).toString('hex')
  async function register(user: string) {
    const response = await post('register', {user, password})
    assert.equal(response.status, 200)
    return response.headers.getSetCookie()[0].split(';')[0]
  }
  const alice = await register('alice')
  const bob = await register('bob')
  assert.equal((await post('login', {user:'alice', password:'wrong-password'})).status, 401)
  const host = new WebSocket(root.replace('http', 'ws') + '/relay/host')
  t.after(() => host.terminate())
  await once(host, 'open')
  const room = randomUUID()
  const proof = randomBytes(32).toString('hex')
  host.send(JSON.stringify({v:2, type:'hello', roomID:room, hostToken:proof,
    pairSecretHash:createHash('sha256').update(randomBytes(32)).digest('hex')}))
  assert.equal(JSON.parse(String((await once(host, 'message'))[0])).type, 'ready')
  assert.equal((await post('ticket', {room, proof:'incorrect'})).status, 409)
  const {ticket} = await (await post('ticket', {room, proof, name:'Mac'})).json()
  assert.equal((await post('bind', {ticket}, alice, 'https://example.net')).status, 403)
  assert.equal((await post('bind', {ticket}, alice)).status, 200)
  assert.equal((await post('bind', {ticket}, bob)).status, 410)
  assert.equal((await post('connect', {room}, bob)).status, 404)
  assert.equal((await post('connect', {room}, alice)).status, 200)
  const phone = new WebSocket(root.replace('http', 'ws') + '/ws', {headers:{cookie:alice, origin}})
  await once(phone, 'open')
  const disconnected = once(phone, 'close')
  assert.equal((await post('logout', {}, alice)).status, 200)
  await disconnected
  assert.equal((await post('connect', {room}, alice)).status, 401)
})
