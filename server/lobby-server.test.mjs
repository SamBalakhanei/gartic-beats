import { withVoice } from './test-voice.mjs'
import { emptyPattern } from '../src/music/pattern.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { attachLobbyServer } from './lobby-server.ts'

async function setup(t, grace = 150, musicDuration) {
  const http = createServer()
  const lobby = attachLobbyServer(http, grace, musicDuration)
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
  await host.next('ack')
  await guest.next('room', message => message.room.game?.phase === 'prompts')
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


async function startRound(connect) {
  const host = await connect()
  const created = await create(host)
  const guest = await connect()
  guest.send({ type: 'join', roomId: created.room.id, name: 'Guest' })
  const joined = await guest.next('joined')
  host.send({ type: 'start' })
  await host.next('ack')
  const view = await host.next('room', message => message.room.game?.phase === 'prompts')
  return { host, guest, created, joined, gameId: view.room.game.id }
}

async function submitBothPrompts(round) {
  const { host, guest, gameId } = round
  host.send({ type: 'prompt', gameId, prompt: 'Host secret prompt' })
  await host.next('ack')
  guest.send({ type: 'prompt', gameId, prompt: 'Guest secret prompt' })
  await guest.next('ack')
  const hostView = await host.next('room', message => message.room.game?.phase === 'music')
  const guestView = await guest.next('room', message => message.room.game?.phase === 'music')
  return { hostView, guestView }
}

test('full round keeps assignments private, restores saved drafts, then reveals all submitted songs', async t => {
  const connect = await setup(t, 1000)
  const round = await startRound(connect)
  const { host, guest, gameId, joined, created } = round
  const { hostView, guestView } = await submitBothPrompts(round)
  assert.equal(hostView.room.game.mine.prompt, 'Guest secret prompt')
  assert.equal(guestView.room.game.mine.prompt, 'Host secret prompt')
  assert.deepEqual(hostView.room.game.results, [])
  assert.equal(hostView.room.game.deadline - hostView.room.game.serverNow <= 600000, true)
  assert.ok(hostView.room.game.deadline - hostView.room.game.serverNow > 599000)
  const late = await connect()
  late.send({ type: 'join', roomId: created.room.id, name: 'Too late' })
  assert.equal((await late.next('error')).code, 'in_progress')
  const voice = withVoice({ bpm: 93 }).voice
  const song = { pattern: emptyPattern(), bpm: 93, mix: { beat: 0.35, voice: 0.9 }, piano: { root: 3, mode: 'minor', volume: 0.4, warmth: 0.8, swing: 0.2, notes: [{ id: 'keys', degree: 2, start: 4, length: 3, velocity: 0.6 }] }, vocals: [
    { id: 'lead', name: 'Lead', voice, bpm: 186, startStep: 0.5, volume: 0.8, trimStart: 0.25, trimEnd: 4 },
    { id: 'harmony', name: 'Harmony', voice, bpm: 93, startStep: 16, volume: 0.5 },
  ] }
  song.pattern.tom[17] = true
  guest.send({ type: 'draft', gameId, song, revision: 1 })
  assert.equal((await guest.next('draft_saved')).revision, 1)
  guest.socket.close()
  await host.next('room', message => message.room.players.some(player => !player.connected))
  const restored = await connect()
  restored.send({ type: 'resume', ...joined.session })
  const resumed = await restored.next('joined')
  assert.deepEqual(resumed.room.game.mine.song, song)
  assert.equal(resumed.room.game.mine.prompt, 'Host secret prompt')
  assert.equal(resumed.room.game.deadline, guestView.room.game.deadline)
  host.send({ type: 'submit_song', gameId, song: withVoice({ pattern: emptyPattern(), bpm: 120 }) })
  await host.next('ack')
  const waiting = await host.next('room', message => message.room.game?.mine?.submitted)
  assert.equal(waiting.room.game.phase, 'music')
  assert.equal(waiting.room.game.completed, 1)
  assert.deepEqual(waiting.room.game.results, [])
  host.send({ type: 'draft', gameId, song, revision: 2 })
  assert.equal((await host.next('error')).code, 'game')
  restored.send({ type: 'submit_song', gameId, song })
  await restored.next('ack')
  const results = await host.next('room', message => message.room.game?.phase === 'results')
  assert.equal(results.room.game.results.length, 2)
  const guestResult = results.room.game.results.find(result => result.playerId === joined.session.playerId)
  assert.deepEqual(guestResult.song, song)
  assert.equal(guestResult.prompt, 'Host secret prompt')
  assert.equal(guestResult.promptAuthor, 'Host')
  assert.equal(guestResult.automatic, false)
})

test('server timer reveals saved drafts even when nobody submits a song', async t => {
  const connect = await setup(t, 1000, 180)
  const round = await startRound(connect)
  await submitBothPrompts(round)
  const song = { pattern: emptyPattern(), bpm: 80 }
  song.pattern.kick[0] = true
  round.host.send({ type: 'draft', gameId: round.gameId, song, revision: 1 })
  await round.host.next('draft_saved')
  const results = await round.guest.next('room', message => message.room.game?.phase === 'results')
  assert.equal(results.room.game.results.length, 2)
  assert.ok(results.room.game.results.every(result => result.automatic))
  assert.deepEqual(results.room.game.results.find(result => result.name === 'Host').song, song)
  round.host.send({ type: 'submit_song', gameId: round.gameId, song })
  assert.equal((await round.host.next('error')).code, 'game')
})

test('a departed prompt writer gets a fallback and cannot block the remaining player', async t => {
  const connect = await setup(t)
  const round = await startRound(connect)
  round.host.send({ type: 'prompt', gameId: round.gameId, prompt: 'A dancing cat' })
  await round.host.next('ack')
  round.guest.send({ type: 'leave' })
  await round.guest.next('left')
  const music = await round.host.next('room', message => message.room.game?.phase === 'music')
  assert.ok(music.room.game.mine.prompt)
  assert.equal(music.room.game.completed, 1)
  round.host.send({ type: 'submit_song', gameId: round.gameId, song: withVoice({ pattern: emptyPattern(), bpm: 120 }) })
  await round.host.next('ack')
  await round.host.next('room', message => message.room.game?.phase === 'results')
})
