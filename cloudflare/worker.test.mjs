import test from 'node:test'
import assert from 'node:assert/strict'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { emptyPattern } from '../src/music/pattern.ts'

function client(ws) {
  ws.accept()
  const messages = []
  ws.addEventListener('message', event => { if (event.data !== 'pong') messages.push(JSON.parse(event.data)) })
  return { ws, messages, send: value => ws.send(JSON.stringify(value)), async wait(predicate) {
    const end = Date.now() + 5000
    while (Date.now() < end) { const index = messages.findIndex(predicate); if (index >= 0) return messages.splice(index, 1)[0]; await new Promise(r => setTimeout(r, 5)) }
    throw new Error('Message timeout: ' + JSON.stringify(messages))
  } }
}
test('Cloudflare runtime: authenticated rooms, readiness, metadata-only songs, reveal, reconnect', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'test', modules: true, scriptPath: 'dist/beat_telephone/index.js', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'], durableObjects: { ROOMS: { className: 'Room', useSQLite: true } } }))
  const sockets = []
  try {
    const room = 'a'.repeat(32)
    const connect = async () => {
      const response = await mf.dispatchFetch('http://localhost/lobby?room=' + room, { headers: { Upgrade: 'websocket', Origin: 'http://localhost' } })
      assert.equal(response.status, 101)
      sockets.push(response.webSocket)
      return client(response.webSocket)
    }
    assert.equal((await mf.dispatchFetch('http://localhost/lobby?room=' + room, { headers: { Upgrade: 'websocket', Origin: 'https://attacker.example' } })).status, 403)
    const host = await connect(); host.send({ type: 'create', name: 'Host' })
    const h = await host.wait(m => m.type === 'joined')
    const guest = await connect(); guest.send({ type: 'join', name: 'Guest' })
    const g = await guest.wait(m => m.type === 'joined')
    host.send({ type: 'start' })
    assert.match((await host.wait(m => m.type === 'error')).message, /direct audio/)
    host.send({ type: 'peers', peers: [g.session.playerId] }); guest.send({ type: 'peers', peers: [h.session.playerId] })
    await host.wait(m => m.type === 'room' && m.room.players.every(p => p.peerReady))
    guest.send({ type: 'start' }); assert.match((await guest.wait(m => m.type === 'error')).message, /host/)
    host.send({ type: 'signal', to: g.session.playerId, signal: { test: 1 } })
    assert.equal((await guest.wait(m => m.type === 'signal')).from, h.session.playerId)
    host.send({ type: 'start' })
    const started = await host.wait(m => m.type === 'room' && m.room.game?.phase === 'prompts')
    const gameId = started.room.game.id
    host.send({ type: 'prompt', gameId, prompt: 'Host secret' }); guest.send({ type: 'prompt', gameId, prompt: 'Guest secret' })
    const music = await host.wait(m => m.type === 'room' && m.room.game?.phase === 'music')
    assert.equal(music.room.game.mine.prompt, 'Guest secret')
    assert.equal(music.room.game.results.length, 0)
    const song = { pattern: emptyPattern(), bpm: 120, voice: { data: 'p2p:' + 'f'.repeat(64), bpm: 120 } }
    host.send({ type: 'draft', round: 1, gameId, song: { ...song, voice: { data: 'base64-audio', bpm: 120 } } })
    assert.match((await host.wait(m => m.type === 'error')).message, /reference/)
    host.send({ type: 'draft', round: 1, gameId, song, revision: 42 })
    assert.equal((await host.wait(m => m.type === 'draft_saved')).revision, 42)
    await mf.unsafeEvictDurableObject('test', 'Room', { name: room, webSockets: 'hibernate' })
    host.send({ type: 'draft', round: 1, gameId, song, revision: 43 })
    assert.equal((await host.wait(m => m.type === 'draft_saved')).revision, 43)
    host.ws.close(); await new Promise(r => setTimeout(r, 50))
    const resumed = await connect(); resumed.send({ type: 'resume', ...h.session })
    const restored = await resumed.wait(m => m.type === 'joined')
    assert.deepEqual(restored.room.game.mine.song, song)
    resumed.send({ type: 'submit_song', round: 1, gameId, song }); guest.send({ type: 'submit_song', round: 1, gameId, song })
    const result = await resumed.wait(m => m.type === 'room' && m.room.game?.phase === 'results')
    assert.equal(result.room.game.results.length, 1)
    guest.send({ type: 'reveal', gameId, action: 'next', revision: 0 })
    assert.match((await guest.wait(m => m.type === 'error')).message, /host/)
    resumed.send({ type: 'reveal', gameId, action: 'next', revision: 0 })
    await resumed.wait(m => m.type === 'room' && m.room.game?.reveal.index === 1)
    resumed.send({ type: 'leave' }); await resumed.wait(m => m.type === 'left')
    const moved = await guest.wait(m => m.type === 'room' && m.room.hostId === g.session.playerId)
    assert.equal(moved.room.players.length, 1)
  } finally { for (const ws of sockets) try { ws.close() } catch {} await mf.dispose() }
})


test('Cloudflare rotates private chains, rejects stale rounds and restores large rooms after hibernation', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ name: 'chains', modules: true, scriptPath: 'dist/beat_telephone/index.js', compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'], durableObjects: { ROOMS: { className: 'Room', useSQLite: true } } }))
  const room = 'b'.repeat(32), clients = [], sessions = []
  try {
    for (let i = 0; i < 3; i++) {
      const response = await mf.dispatchFetch('http://localhost/lobby?room=' + room, { headers: { Upgrade: 'websocket', Origin: 'http://localhost' } })
      const c = client(response.webSocket); clients.push(c)
      c.send({ type: i === 0 ? 'create' : 'join', name: `Player ${i}` })
      sessions.push((await c.wait(m => m.type === 'joined')).session)
    }
    clients.forEach((c, i) => c.send({ type: 'peers', peers: sessions.filter((_, j) => i !== j).map(s => s.playerId) }))
    await clients[0].wait(m => m.type === 'room' && m.room.players.length === 3 && m.room.players.every(p => p.peerReady))
    clients[0].send({ type: 'start' })
    const gameId = (await clients[0].wait(m => m.type === 'room' && m.room.game?.phase === 'prompts')).room.game.id
    clients.forEach((c, i) => c.send({ type: 'prompt', gameId, prompt: `SECRET ${i}` }))
    await clients[0].wait(m => m.type === 'room' && m.room.game?.round === 1)
    const song = { pattern: emptyPattern(), bpm: 95, piano: { root: 0, mode: 'major', volume: .6, warmth: .7, swing: .1, notes: Array.from({ length: 512 }, (_, i) => ({ id: String(i).padStart(64, 'x'), start: i % 64, degree: i % 8, length: 1, velocity: .7 })) } }
    assert.ok(JSON.stringify(song).length * 3 > 128 * 1024)
    clients.forEach(c => c.send({ type: 'submit_song', gameId, round: 1, song }))
    const second = (await clients[0].wait(m => m.type === 'room' && m.room.game?.round === 2)).room.game
    assert.equal(second.mine.prompt, null)
    assert.ok(!JSON.stringify(second).includes('SECRET'))
    assert.deepEqual(second.mine.song.layers, [song])
    clients[0].send({ type: 'draft', gameId, round: 1, song })
    assert.match((await clients[0].wait(m => m.type === 'error')).message, /ended/)
    await mf.unsafeEvictDurableObject('chains', 'Room', { name: room, webSockets: 'hibernate' })
    clients[0].send({ type: 'draft', gameId, round: 2, song, revision: 15 })
    assert.equal((await clients[0].wait(m => m.type === 'draft_saved')).revision, 15)
    clients.forEach(c => c.send({ type: 'submit_song', gameId, round: 2, song }))
    const final = (await clients[0].wait(m => m.type === 'room' && m.room.game?.phase === 'results')).room.game
    assert.equal(final.revealTotal, 9)
    for (let revision = 0; revision < 2; revision++) {
      clients[0].send({ type: 'reveal', gameId, action: 'next', revision })
      await clients[0].wait(m => m.type === 'room' && m.room.game?.reveal.index === revision + 1)
    }
    await mf.unsafeEvictDurableObject('chains', 'Room', { name: room, webSockets: 'hibernate' })
    clients[0].send({ type: 'reveal', gameId, action: 'play', revision: 2 })
    const revealed = (await clients[0].wait(m => m.type === 'room' && m.room.game?.reveal.revision === 3)).room.game.results[0]
    assert.equal(revealed.contribution, 2)
    assert.equal(revealed.song.layers, undefined)
    assert.deepEqual(revealed.song.piano, song.piano)
    assert.equal(revealed.prompt, 'SECRET 0')
  } finally { for (const c of clients) try { c.ws.close() } catch {} await mf.dispose() }
})
