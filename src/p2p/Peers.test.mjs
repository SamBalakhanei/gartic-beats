import test from 'node:test'
import assert from 'node:assert/strict'
import { Peers, ICE_SERVERS } from './Peers.ts'
import { emptyPattern } from '../music/pattern.ts'
import { withVoice } from '../../server/test-voice.mjs'

const pcs = new Map()
let nextId = 0
class Channel {
  readyState = 'connecting'; bufferedAmount = 0
  send(message) { if (this.readyState !== 'open') throw new Error('closed'); queueMicrotask(() => this.other?.onmessage?.({ data: message })) }
  close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.onclose?.(); if (this.other?.readyState !== 'closed') this.other?.close() }
}
class Connection {
  id = String(nextId++); connectionState = 'new'
  constructor() { pcs.set(this.id, this) }
  createDataChannel() { return this.channel = new Channel() }
  async createOffer() { return { type: 'offer', sdp: this.id } }
  async createAnswer() { return { type: 'answer', sdp: this.id } }
  async setLocalDescription(description) { this.localDescription = description }
  async setRemoteDescription(description) {
    this.remoteDescription = description
    const other = pcs.get(description.sdp)
    if (description.type === 'offer') {
      this.channel = new Channel(); this.channel.other = other.channel; other.channel.other = this.channel
      this.ondatachannel?.({ channel: this.channel })
    } else {
      for (const pc of [this, other]) { pc.connectionState = 'connected'; pc.channel.readyState = 'open' }
      for (const pc of [this, other]) pc.channel.onopen?.()
    }
  }
  async addIceCandidate() {}
  close() { this.channel?.close(); this.connectionState = 'closed' }
}
async function until(predicate) {
  const end = Date.now() + 3000
  while (!predicate()) { if (Date.now() >= end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)) }
}
test('peer transport chunks lossless recordings, waits for receipts, and restores from another browser', async () => {
  const previous = globalThis.RTCPeerConnection
  globalThis.RTCPeerConnection = Connection
  const signals = [], notices = [], managers = new Map()
  const make = id => {
    const peer = new Peers(message => {
      signals.push(message)
      if (message.type === 'signal') queueMicrotask(() => managers.get(message.to)?.signal(id, message.signal))
    }, () => {}, text => notices.push(text))
    managers.set(id, peer); return peer
  }
  const a = make('a'), b = make('b')
  const room = { id: 'room', hostId: 'a', players: [{ id: 'a', connected: true }, { id: 'b', connected: true }] }
  try {
    a.sync(room, 'a'); b.sync(room, 'b')
    await until(() => signals.filter(m => m.type === 'peers' && m.peers.length === 1).length >= 2)
    const song = withVoice({ pattern: emptyPattern(), bpm: 120, mix: { beat: .1, voice: .9 } })
    const wire = await a.prepare(song)
    await a.shared(wire)
    assert.deepEqual(b.hydrate(wire), { ...song, vocals: undefined })
    assert.ok(!JSON.stringify(signals).includes(song.voice.data.slice(0, 500)))
    const mixed = await a.prepare({ ...song, bpm: 96, mix: { beat: .2, voice: 1 } })
    assert.equal(mixed.voice.data, wire.voice.data)
    assert.equal(b.hydrate(mixed).mix.voice, 1)
    b.close()
    a.sync({ ...room, players: [room.players[0]] }, 'a')
    const restored = make('b')
    a.sync(room, 'a'); restored.sync(room, 'b')
    await until(() => restored.hydrate(wire) !== null)
    assert.equal(restored.hydrate(wire).voice.data, song.voice.data)
    assert.deepEqual(notices, [])
    assert.ok(ICE_SERVERS.every(server => [server.urls].flat().every(url => url.startsWith('stun:'))))
  } finally { for (const peer of managers.values()) peer.close(); a.close(); globalThis.RTCPeerConnection = previous; pcs.clear() }
})

test('exit snapshots synchronously preserve prepared audio and latest edits without draft traffic', async () => {
  const messages = []
  const manager = new Peers(message => messages.push(message), () => {}, () => {})
  try {
    const song = withVoice({ pattern: emptyPattern(), bpm: 120 })
    assert.equal(manager.snapshot(song).voice, undefined, 'unprepared audio cannot be hashed during page exit')
    const wire = await manager.prepare(song)
    const edited = { ...song, mix: { beat: .2, voice: .8 }, layers: [song] }
    edited.pattern.kick[5] = true
    const snapshot = manager.snapshot(edited)
    assert.equal(snapshot.voice.data, wire.voice.data)
    assert.equal(snapshot.pattern.kick[5], true)
    assert.deepEqual(snapshot.mix, edited.mix)
    assert.equal(snapshot.layers, undefined)
    assert.deepEqual(messages, [], 'editing/preparing never sends a coordinator draft')
    assert.deepEqual(manager.hydrate(snapshot).voice, song.voice)
  } finally { manager.close() }
})
