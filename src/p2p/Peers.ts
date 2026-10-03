import type { Lobby } from '../lobby/lobby.ts'
import type { Song } from '../game/types.ts'
import type { VoiceTrack } from '../music/voice.ts'
import { MAX_VOICE_BYTES } from '../music/voice.ts'
import { hydrate, isReference, manifest, tracks, verifyAudio } from './audio.ts'

// Deliberately no TURN servers: blocked direct connections fail without paid fallback.
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const MAX_FILE = Math.ceil(MAX_VOICE_BYTES / 3) * 4
const MAX_CACHE = 128 * 1024 * 1024
const CHUNK = 12_000

type Peer = { pc: RTCPeerConnection; channel?: RTCDataChannel; candidates: RTCIceCandidateInit[]; receipts: Set<string>; requested: Set<string>; outgoing: Promise<void>; incoming?: { id: string; bpm: number; length: number; data: string }; signalQueue: Promise<void>; receiveQueue: Promise<void> }
export class Peers {
  private peers = new Map<string, Peer>()
  private audio = new Map<string, VoiceTrack>()
  private hashes = new Map<string, string>()
  private cacheSize = 0
  private room = ''
  private closed = false
  private members: string[] = []
  private prepared = new WeakMap<Song, Promise<Song>>()
  private send: (message: unknown) => void
  private changed: () => void
  private notice: (text: string) => void
  constructor(send: (message: unknown) => void, changed: () => void, notice: (text: string) => void) { this.send = send; this.changed = changed; this.notice = notice }
  report() {
    if (this.closed) return
    this.send({ type: 'peers', peers: [...this.peers].filter(([, p]) => p.channel?.readyState === 'open').map(([id]) => id) })
    this.changed()
  }
  sync(room: Lobby, me: string) {
    if (this.room && this.room !== room.id) this.reset()
    this.room = room.id
    this.members = room.players.filter(p => p.connected && p.id !== me).map(p => p.id)
    for (const [id, peer] of this.peers) if (!this.members.includes(id)) { peer.pc.close(); this.peers.delete(id) }
    for (const id of this.members) if (!this.peers.has(id)) {
      try {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
        const peer: Peer = { pc, candidates: [], receipts: new Set(), requested: new Set(), outgoing: Promise.resolve(), signalQueue: Promise.resolve(), receiveQueue: Promise.resolve() }
        this.peers.set(id, peer)
        pc.onicecandidate = event => { if (event.candidate) this.send({ type: 'signal', to: id, signal: { candidate: event.candidate.toJSON() } }) }
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') { this.report(); this.notice('A direct audio connection failed. Try another network, or leave and rejoin. No paid relay is enabled.') }
        }
        pc.ondatachannel = event => this.attach(id, peer, event.channel)
        if (me < id) {
          this.attach(id, peer, pc.createDataChannel('songs', { ordered: true }))
          peer.signalQueue = (async () => { await pc.setLocalDescription(await pc.createOffer()); this.send({ type: 'signal', to: id, signal: { description: pc.localDescription } }) })().catch(() => this.notice('Could not establish a direct audio connection.'))
        }
      } catch { this.notice('This browser cannot create peer connections. Use a current browser with WebRTC support.') }
    }
  }
  signal(id: string, value: unknown) {
    const peer = this.peers.get(id)
    if (!peer || !value || typeof value !== 'object') return
    const signal = value as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
    peer.signalQueue = peer.signalQueue.then(async () => {
      if (signal.description) {
        if (!['offer', 'answer'].includes(signal.description.type)) return
        await peer.pc.setRemoteDescription(signal.description)
        for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate)
        if (signal.description.type === 'offer') {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer())
          this.send({ type: 'signal', to: id, signal: { description: peer.pc.localDescription } })
        }
      } else if (signal.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate)
        else if (peer.candidates.length < 64) peer.candidates.push(signal.candidate)
      }
    }).catch(() => this.notice('Direct audio connection failed. Try another network or rejoin the lobby.'))
  }
  private attach(id: string, peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel
    channel.onopen = () => { this.report(); this.tell(peer, { type: 'have', files: [...this.audio.keys()] }) }
    channel.onclose = () => { peer.receipts.clear(); peer.requested.clear(); peer.incoming = undefined; this.report() }
    channel.onerror = () => this.notice('A peer audio transfer failed. Keep the tab open and reconnect.')
    channel.onmessage = event => {
      peer.receiveQueue = peer.receiveQueue.then(async () => {
        if (typeof event.data !== 'string' || event.data.length > CHUNK + 1024) throw new Error('Invalid peer message.')
        const m = JSON.parse(event.data)
        if (m.type === 'have') {
          if (!Array.isArray(m.files) || m.files.length > 128 || !m.files.every((id: unknown) => typeof id === 'string' && isReference(id))) throw new Error('Invalid audio inventory.')
          for (const hash of m.files) {
            if (this.audio.has(hash)) this.tell(peer, { type: 'ack', id: hash })
            else if (!peer.requested.has(hash)) { peer.requested.add(hash); this.tell(peer, { type: 'get', id: hash }) }
          }
        } else if (m.type === 'get') {
          const track = this.audio.get(m.id)
          if (track) {
            peer.outgoing = peer.outgoing.then(async () => {
              await this.push(peer, { type: 'begin', id: m.id, bpm: track.bpm, length: track.data.length })
              for (let offset = 0; offset < track.data.length; offset += CHUNK) await this.push(peer, { type: 'chunk', data: track.data.slice(offset, offset + CHUNK) })
              await this.push(peer, { type: 'end' })
            }).catch(() => this.notice('Audio sharing was interrupted. Keep your tab open and rejoin if needed.'))
          }
        } else if (m.type === 'begin') {
          if (peer.incoming || !isReference(m.id) || !Number.isInteger(m.length) || m.length < 44 || m.length > MAX_FILE || this.cacheSize + m.length > MAX_CACHE) throw new Error('Peer recording limit reached.')
          peer.incoming = { id: m.id, bpm: m.bpm, length: m.length, data: '' }
        } else if (m.type === 'chunk') {
          if (!peer.incoming || typeof m.data !== 'string' || peer.incoming.data.length + m.data.length > peer.incoming.length) throw new Error('Invalid audio chunk.')
          peer.incoming.data += m.data
        } else if (m.type === 'end') {
          const file = peer.incoming; peer.incoming = undefined
          if (!file || file.data.length !== file.length) throw new Error('Incomplete recording.')
          const track = { data: file.data, bpm: file.bpm }
          await verifyAudio(file.id, track)
          this.store(file.id, track); peer.requested.delete(file.id)
          this.tell(peer, { type: 'ack', id: file.id }); this.changed()
        } else if (m.type === 'ack' && this.audio.has(m.id)) peer.receipts.add(m.id)
      }).catch(() => { peer.incoming = undefined; peer.requested.clear(); this.notice(`A recording from another player could not be received. Try rejoining before the reveal.`) })
    }
    // id remains associated with this channel through its owning peer map.
    void id
  }
  private tell(peer: Peer, value: unknown) { if (peer.channel?.readyState === 'open') peer.channel.send(JSON.stringify(value)) }
  private async push(peer: Peer, value: unknown) {
    const start = Date.now()
    while (peer.channel?.readyState === 'open' && peer.channel.bufferedAmount > 128_000) {
      if (this.closed || Date.now() - start > 30_000) throw new Error('Transfer timed out')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    if (this.closed || peer.channel?.readyState !== 'open') throw new Error('Peer disconnected')
    this.tell(peer, value)
  }
  private store(id: string, track: VoiceTrack) {
    if (this.closed || this.audio.has(id)) return
    if (this.cacheSize + track.data.length > MAX_CACHE || this.audio.size >= 128) throw new Error('This room’s recording cache is full. Start a new room.')
    this.audio.set(id, track); this.hashes.set(track.data, id); this.cacheSize += track.data.length
  }
  async prepare(song: Song): Promise<Song> {
    const existing = this.prepared.get(song)
    if (existing) return existing
    const promise = (async () => {
      // Reusing a take while adjusting its mix never rehashes/retransmits its bytes.
      const known = { ...song, vocals: song.vocals?.map(clip => ({ ...clip, voice: { ...clip.voice, data: this.hashes.get(clip.voice.data) ?? clip.voice.data } })), ...(song.voice ? { voice: { ...song.voice, data: this.hashes.get(song.voice.data) ?? song.voice.data } } : {}) }
      const result = await manifest(known, (id, track) => this.store(id, track))
      const files = tracks(result).map(t => t.data)
      for (const peer of this.peers.values()) this.tell(peer, { type: 'have', files: files.filter(id => !peer.receipts.has(id)) })
      return result
    })()
    this.prepared.set(song, promise)
    return promise
  }
  // Synchronous best-effort manifest for pagehide: crypto cannot be awaited there.
  snapshot(song: Song): Song {
    const { layers: _history, voice, vocals, ...part } = song
    const reference = (track: VoiceTrack) => {
      const data = isReference(track.data) ? track.data : this.hashes.get(track.data)
      return data ? { ...track, data } : undefined
    }
    return { ...part,
      ...(vocals ? { vocals: vocals.flatMap(clip => { const voice = reference(clip.voice); return voice ? [{ ...clip, voice }] : [] }) } : {}),
      ...(voice && reference(voice) ? { voice: reference(voice) } : {}),
    }
  }
  async shared(song: Song) {
    const files = tracks(song).map(t => t.data)
    const start = Date.now()
    while (this.members.some(id => { const p = this.peers.get(id); return !p || files.some(hash => !p.receipts.has(hash)) })) {
      if (this.closed || Date.now() - start > 30_000) throw new Error('Your song is still in this tab, but sharing is incomplete. Keep this tab open, check connections, then submit again.')
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  hydrate(song: Song) { return hydrate(song, id => this.audio.get(id)) }
  reset() {
    for (const peer of this.peers.values()) { peer.channel?.close(); peer.pc.close() }
    this.peers.clear(); this.audio.clear(); this.hashes.clear(); this.cacheSize = 0; this.members = []; this.room = ''; this.prepared = new WeakMap()
  }
  close() { this.closed = true; this.reset() }
}
