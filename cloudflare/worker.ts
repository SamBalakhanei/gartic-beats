import { SUBMISSION_GRACE_MS } from '../src/game/types.ts'
import { DurableObject } from 'cloudflare:workers'
import { createGame, controlReveal, departGame, finishIfReady, gameView, saveSong, submitPrompt } from '../server/game.ts'
import type { Game } from '../server/game.ts'
import { canStart, MAX_PLAYERS } from '../src/lobby/lobby.ts'
import type { Lobby } from '../src/lobby/lobby.ts'

interface Env { ROOMS: DurableObjectNamespace<Room>; ASSETS: Fetcher }
type Member = { id: string; name: string; token: string; expires?: number }
type State = { id: string; hostId: string; players: Member[]; game?: Game; expires: number }
type Attachment = { playerId?: string; expires?: number; peers: string[]; window: number; count: number }
const TTL = 2 * 60 * 60 * 1000
const GRACE = 30_000

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/lobby') return env.ASSETS.fetch(request)
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 })
    if (request.headers.get('Origin') !== url.origin) return new Response('Origin not allowed', { status: 403 })
    const id = url.searchParams.get('room') ?? ''
    if (!/^[a-f0-9]{32}$/.test(id)) return new Response('Invalid room', { status: 400 })
    return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(request)
  },
} satisfies ExportedHandler<Env>

export class Room extends DurableObject<Env> {
  private room: State | undefined
  private storedChunks = 0
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<State | { chunks: number }>('room')
      if (stored && 'chunks' in stored) {
        this.storedChunks = stored.chunks
        const chunks = await ctx.storage.get<string>(Array.from({ length: stored.chunks }, (_, i) => `room:${i}`))
        this.room = JSON.parse(Array.from({ length: stored.chunks }, (_, i) => chunks.get(`room:${i}`)).join('')) as State
      } else this.room = stored
      // An old single-song game cannot resume using the new round protocol.
      if (this.room?.game && !Array.isArray(this.room.game.order)) {
        this.room = undefined
        await ctx.storage.deleteAll()
      }
    })
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }
  private sockets() { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1) }
  private info(ws: WebSocket): Attachment { return ws.deserializeAttachment() as Attachment }
  private socket(id: string) { return this.sockets().find(ws => this.info(ws).playerId === id) }
  private send(ws: WebSocket, value: unknown) { if (ws.readyState === 1) ws.send(JSON.stringify(value)) }
  private snapshot(id: string): Lobby {
    const room = this.room!
    const connected = room.players.filter(p => !!this.socket(p.id))
    return { id: room.id, hostId: room.hostId, game: room.game ? gameView(room.game, id, Date.now()) : undefined,
      players: room.players.map(p => ({ id: p.id, name: p.name, connected: !!this.socket(p.id), peerReady: connected.every(other => other.id === p.id || !!this.socket(p.id) && this.info(this.socket(p.id)!).peers.includes(other.id)) })) }
  }
  private broadcast() {
    if (!this.room) return
    for (const p of this.room.players) { const ws = this.socket(p.id); if (ws) this.send(ws, { type: 'room', room: this.snapshot(p.id) }) }
  }
  private async persist() {
    const json = this.room ? JSON.stringify(this.room) : ''
    // At most 64 KiB of UTF-8 per chunk, even for non-ASCII prompts and names.
    const chunks = Array.from({ length: Math.ceil(json.length / 16000) }, (_, i) => json.slice(i * 16000, (i + 1) * 16000))
    await this.ctx.storage.transaction(async storage => {
      for (let i = 0; i < chunks.length; i++) await storage.put(`room:${i}`, chunks[i])
      for (let i = chunks.length; i < this.storedChunks; i++) await storage.delete(`room:${i}`)
      if (this.room) await storage.put('room', { chunks: chunks.length })
      else await storage.delete('room')
    })
    this.storedChunks = chunks.length
    await this.schedule()
  }
  private async schedule() {
    const deadlines = this.sockets().map(ws => this.info(ws).expires).filter((n): n is number => !!n)
    if (this.room) {
      deadlines.push(this.room.expires)
      for (const p of this.room.players) if (p.expires) deadlines.push(p.expires)
      if (this.room.game?.phase === 'music') deadlines.push(this.room.game.deadline! + (this.room.game.submissionGrace ?? SUBMISSION_GRACE_MS))
    }
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)))
    else await this.ctx.storage.deleteAlarm()
  }
  private remove(id: string) {
    const room = this.room
    if (!room) return
    if (room.game) departGame(room.game, id, Date.now())
    room.players = room.players.filter(p => p.id !== id)
    for (const ws of this.sockets()) { const a = this.info(ws); a.peers = a.peers.filter(p => p !== id); ws.serializeAttachment(a) }
    if (!room.players.length) this.room = undefined
    else if (room.hostId === id) room.hostId = (room.players.find(p => this.socket(p.id)) ?? room.players[0]).id
  }
  async fetch(request: Request): Promise<Response> {
    if (this.room && Date.now() >= this.room.expires) await this.alarm()
    if (this.sockets().length >= 16) return new Response('Room connection limit', { status: 429 })
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    pair[1].serializeAttachment({ peers: [], expires: Date.now() + 10_000, window: Date.now(), count: 0 } satisfies Attachment)
    // Room id comes from the routed URL, never from a client message.
    if (!this.room) {
      pair[1].serializeAttachment({ ...this.info(pair[1]), roomId: new URL(request.url).searchParams.get('room') })
    }
    await this.schedule()
    return new Response(null, { status: 101, webSocket: pair[0] })
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    try {
      if (typeof raw !== 'string' || raw.length > 96_000) throw new Error('Room messages must be small. Audio must travel peer-to-peer.')
      const a = this.info(ws)
      if (Date.now() - a.window >= 10_000) { a.window = Date.now(); a.count = 0 }
      if (++a.count > 100) { ws.close(1008, 'Too many requests'); return }
      ws.serializeAttachment(a)
      const m = JSON.parse(raw) as Record<string, unknown>
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Invalid request.')
      if (['create', 'join', 'resume'].includes(String(m.type))) {
        if (a.playerId) throw new Error('Leave your current room first.')
        if (m.type === 'resume') {
          const member = this.room?.players.find(p => p.token === m.token)
          if (!member) { this.send(ws, { type: 'error', code: 'session_expired', message: 'This room expired. Create a new game.' }); return }
          if (this.socket(member.id)) { this.send(ws, { type: 'error', code: 'session_in_use', message: 'This player is already connected. Join with a new name.' }); return }
          delete member.expires
          a.playerId = member.id
        } else {
          if (typeof m.name !== 'string' || !m.name.trim() || m.name.trim().length > 24) throw new Error('Enter a name between 1 and 24 characters.')
          if (m.type === 'create') {
            if (this.room) throw new Error('This room already exists.')
            const id = (ws.deserializeAttachment() as { roomId: string }).roomId
            if (!id) throw new Error('Reconnect to create a room.')
            this.room = { id, hostId: '', players: [], expires: Date.now() + TTL }
          }
          if (!this.room) throw new Error('This room no longer exists. Ask for a new invite.')
          if (this.room.game) throw new Error('This game has already started.')
          if (this.room.players.length >= MAX_PLAYERS) throw new Error('This room is full.')
          const member = { id: crypto.randomUUID(), name: m.name.trim(), token: crypto.randomUUID() }
          this.room.players.push(member)
          this.room.hostId ||= member.id
          a.playerId = member.id
        }
        delete a.expires
        ws.serializeAttachment(a)
        if (this.room!.game) finishIfReady(this.room!.game, Date.now())
        await this.persist()
        const member = this.room!.players.find(p => p.id === a.playerId)!
        this.send(ws, { type: 'joined', room: this.snapshot(member.id), session: { roomId: this.room!.id, playerId: member.id, token: member.token } })
        this.broadcast()
        return
      }
      const room = this.room
      if (!room || !a.playerId || !room.players.some(p => p.id === a.playerId)) throw new Error('Join a room first.')
      if (m.type === 'signal') {
        const target = typeof m.to === 'string' ? this.socket(m.to) : undefined
        if (target && target !== ws && JSON.stringify(m.signal).length <= 16_000) this.send(target, { type: 'signal', from: a.playerId, signal: m.signal })
        return
      }
      if (m.type === 'peers') {
        if (!Array.isArray(m.peers) || m.peers.length > 7 || !m.peers.every(id => typeof id === 'string' && room.players.some(p => p.id === id))) throw new Error('Invalid peer readiness.')
        a.peers = m.peers as string[]
        ws.serializeAttachment(a)
        this.broadcast()
        return
      }
      if (room.game) finishIfReady(room.game, Date.now())
      if (m.type === 'leave') {
        const leavingId = a.playerId
        delete a.playerId; a.peers = []; a.expires = Date.now() + 10_000; ws.serializeAttachment(a)
        this.remove(leavingId)
        this.send(ws, { type: 'left' })
      } else if (m.type === 'start') {
        if (room.hostId !== a.playerId) throw new Error('Only the host can start.')
        if (room.game) throw new Error('The game already started.')
        if (!canStart(this.snapshot(a.playerId))) throw new Error('Wait for every player’s direct audio connection. A blocked network may require switching Wi-Fi.')
        room.game = createGame(room.players.filter(p => this.socket(p.id)))
      } else if (m.type === 'reveal') {
        if (room.hostId !== a.playerId) throw new Error('Only the host controls the reveal.')
        if (!room.game || m.gameId !== room.game.id) throw new Error('Wrong game.')
        controlReveal(room.game, m.action, m.revision)
      } else if (['prompt', 'draft', 'submit_song'].includes(String(m.type))) {
        if (!room.game || m.gameId !== room.game.id) throw new Error('Wrong game.')
        if (m.type === 'prompt') submitPrompt(room.game, a.playerId, m.prompt, Date.now())
        else saveSong(room.game, a.playerId, m.song, m.type === 'submit_song', Date.now(), true, Number(m.round), m.automatic === true)
      } else throw new Error('Unknown request.')
      await this.persist()
      if (m.type === 'draft') this.send(ws, { type: 'draft_saved', revision: Number.isSafeInteger(m.revision) ? m.revision : 0 })
      else { this.broadcast(); if (m.type !== 'leave') this.send(ws, { type: 'ack' }) }
    } catch (error) {
      this.send(ws, { type: 'error', code: 'game', message: error instanceof Error ? error.message : 'Invalid request.' })
      // A rejected late submission can still transition the room to results.
      await this.persist(); this.broadcast()
    }
  }
  async webSocketClose(ws: WebSocket) {
    const id = this.info(ws).playerId
    ws.close(1000, 'Disconnected')
    const player = this.room?.players.find(p => p.id === id)
    if (player && !this.socket(player.id)) player.expires = Date.now() + GRACE
    for (const other of this.sockets()) { const a = this.info(other); a.peers = a.peers.filter(p => p !== id); other.serializeAttachment(a) }
    await this.persist(); this.broadcast()
  }
  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws) }
  async alarm() {
    const now = Date.now()
    for (const ws of this.sockets()) if ((this.info(ws).expires ?? Infinity) <= now) ws.close(1008, 'Join timeout')
    if (this.room && this.room.expires <= now) {
      for (const ws of this.sockets()) { this.send(ws, { type: 'error', code: 'session_expired', message: 'This two-hour room has expired.' }); ws.close(1000, 'Expired') }
      this.room = undefined
      await this.ctx.storage.deleteAll()
      return
    }
    for (const p of [...(this.room?.players ?? [])]) if ((p.expires ?? Infinity) <= now) this.remove(p.id)
    if (this.room?.game) finishIfReady(this.room.game, now)
    await this.persist(); this.broadcast()
  }
}
