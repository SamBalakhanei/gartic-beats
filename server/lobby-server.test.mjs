import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { attachLobbyServer } from './lobby-server.ts'

async function setup(t, grace = 150) {
  const http = createServer()
  const lobby = attachLobbyServer(http, grace)
  const sockets = []
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    for (const socket of sockets) socket.terminate()
    lobby.close()
    await new Promise(resolve => http.close(resolve))
  })
  return async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${http.address().port}/lobby`)
    sockets.push(socket)
    const queue = []
    const listeners = new Set()
    socket.on('message', raw => { queue.push(JSON.parse(raw)); for (const listener of listeners) listener() })
    await once(socket, 'open')
    return {
      socket,
      send: message => socket.send(JSON.stringify(message)),
      next: (type, predicate = () => true) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`Missing ${type}`)) }, 2000)
        function check() {
          const index = queue.findIndex(message => message.type === type && predicate(message))
          if (index >= 0) { clearTimeout(timer); listeners.delete(check); resolve(queue.splice(index, 1)[0]) }
        }
        listeners.add(check)
        check()
      }),
    }
  }
}
async function create(client) {
  client.send({ type: 'create', name: 'Host' })
  return client.next('joined')
}

test('create, join, live rosters, and server-enforced host/minimum rules', async t => {
  const connect = await setup(t)
  const host = await connect()
  const created = await create(host)
  host.send({ type: 'start' })
  assert.equal((await host.next('error')).code, 'too_few')
  const guest = await connect()
  guest.send({ type: 'join', roomId: created.room.id, name: ' Guest ' })
  const joined = await guest.next('joined')
  assert.equal(joined.room.players[1].name, 'Guest')
  const update = await host.next('room', message => message.room.players.length === 2)
  assert.equal(update.room.hostId, created.session.playerId)
  assert.ok(update.room.players.every(player => player.connected))
  assert.equal(JSON.stringify(update).includes(joined.session.token), false)
  guest.send({ type: 'start', playerId: created.session.playerId })
  assert.equal((await guest.next('error')).code, 'host_only')
  host.send({ type: 'start' })
  await host.next('notice')
  await guest.next('notice')
  guest.send({ type: 'leave' })
  await guest.next('left')
  await host.next('room', message => message.room.players.length === 1)
})

test('refresh reconnects the same identity and disconnected guests do not count for start', async t => {
  const connect = await setup(t, 1000)
  const host = await connect()
  const created = await create(host)
  const guest = await connect()
  guest.send({ type: 'join', roomId: created.room.id, name: 'Guest' })
  const joined = await guest.next('joined')
  guest.socket.close()
  await host.next('room', message => message.room.players.some(player => !player.connected))
  host.send({ type: 'start' })
  assert.equal((await host.next('error')).code, 'too_few')
  const refreshed = await connect()
  refreshed.send({ type: 'resume', ...joined.session })
  const restored = await refreshed.next('joined')
  assert.equal(restored.session.playerId, joined.session.playerId)
  assert.equal(restored.room.players.length, 2)
  assert.ok(restored.room.players.every(player => player.connected))
  const imposter = await connect()
  imposter.send({ type: 'resume', roomId: created.room.id, token: 'wrong' })
  assert.equal((await imposter.next('error')).code, 'session_expired')
  imposter.send({ type: 'resume', ...joined.session })
  assert.equal((await imposter.next('error')).code, 'session_in_use')
})

test('disconnect grace expires, host transfers, and empty rooms disappear', async t => {
  const connect = await setup(t)
  const host = await connect()
  const created = await create(host)
  const guest = await connect()
  guest.send({ type: 'join', roomId: created.room.id, name: 'Guest' })
  const joined = await guest.next('joined')
  host.socket.close()
  const update = await guest.next('room', message => message.room.hostId === joined.session.playerId)
  assert.equal(update.room.players.length, 1)
  guest.send({ type: 'leave' })
  await guest.next('left')
  guest.send({ type: 'join', roomId: created.room.id, name: 'Guest' })
  assert.equal((await guest.next('error')).code, 'not_found')
})

test('explicit host leave transfers ownership immediately', async t => {
  const connect = await setup(t)
  const host = await connect()
  const created = await create(host)
  const guest = await connect()
  guest.send({ type: 'join', roomId: created.room.id, name: 'Guest' })
  const joined = await guest.next('joined')
  host.send({ type: 'leave' })
  await host.next('left')
  await guest.next('room', message => message.room.hostId === joined.session.playerId)
})

test('missing/full rooms, invalid names, malformed messages and repeated joins are rejected', async t => {
  const connect = await setup(t)
  const host = await connect()
  host.socket.send('invalid JSON')
  assert.equal((await host.next('error')).code, 'invalid')
  host.send({ type: 'create', name: ' ' })
  assert.equal((await host.next('error')).code, 'name')
  const created = await create(host)
  host.send({ type: 'create', name: 'Duplicate' })
  assert.equal((await host.next('error')).code, 'already_joined')
  for (let i = 1; i < 8; i++) {
    const guest = await connect()
    guest.send({ type: 'join', roomId: created.room.id, name: `Guest ${i}` })
    await guest.next('joined')
  }
  const extra = await connect()
  extra.send({ type: 'join', roomId: 'missing', name: 'Guest' })
  assert.equal((await extra.next('error')).code, 'not_found')
  extra.send({ type: 'join', roomId: created.room.id, name: 'Guest' })
  assert.equal((await extra.next('error')).code, 'full')
})
