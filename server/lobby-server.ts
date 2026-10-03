import { MAX_VOICE_BYTES } from '../src/music/voice.ts'
import { MAX_VOCAL_LAYERS } from '../src/music/arrangement.ts'
import { controlReveal, createGame, departGame, finishIfReady, gameView, saveSong, submitPrompt } from './game.ts'
import type { Game } from './game.ts'
import { MUSIC_DURATION_MS, SUBMISSION_GRACE_MS } from '../src/game/types.ts'
import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { EventEmitter } from 'node:events'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { canStart, MAX_PLAYERS } from '../src/lobby/lobby.ts'
import type { Lobby, ServerMessage } from '../src/lobby/lobby.ts'

type Member = { id: string; name: string; token: string; socket: WebSocket | null; expiry?: ReturnType<typeof setTimeout> }
type Room = { id: string; hostId: string; players: Member[]; game?: Game; gameTimer?: ReturnType<typeof setTimeout> }

export function attachLobbyServer(server: EventEmitter, graceMs = 30_000, musicDuration = MUSIC_DURATION_MS) {
  const rooms = new Map<string, Room>()
  const membership = new Map<WebSocket, { room: Room; player: Member }>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_VOCAL_LAYERS * Math.ceil(MAX_VOICE_BYTES / 3) * 4 + 256_000 })
  let closed = false
  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
  const snapshot = (room: Room, playerId = ''): Lobby => ({
    id: room.id, hostId: room.hostId,
    game: room.game ? gameView(room.game, playerId, Date.now()) : undefined,
    players: room.players.map(player => ({ id: player.id, name: player.name, connected: player.socket?.readyState === WebSocket.OPEN })),
  })
  const broadcast = (room: Room) => {
    for (const player of room.players) if (player.socket) send(player.socket, { type: 'room', room: snapshot(room, player.id) })
  }
  const syncGame = (room: Room) => {
    if (!room.game) return
    const previousPhase = room.game.phase
    finishIfReady(room.game, Date.now())
    if (room.game.phase !== previousPhase) broadcast(room)
    clearTimeout(room.gameTimer); room.gameTimer = undefined
    if (room.game.phase === 'music') {
      room.gameTimer = setTimeout(() => {
        finishIfReady(room.game!, Date.now())
        room.gameTimer = undefined
        syncGame(room)
        broadcast(room)
      }, Math.max(1, room.game.deadline! + (room.game.submissionGrace ?? SUBMISSION_GRACE_MS) - Date.now()))
      room.gameTimer.unref()
    } else if (room.game.phase === 'results') { clearTimeout(room.gameTimer); room.gameTimer = undefined }
  }
  const remove = (room: Room, player: Member) => {
    clearTimeout(player.expiry)
    if (room.game) { departGame(room.game, player.id, Date.now(), musicDuration); syncGame(room) }
    if (player.socket) membership.delete(player.socket)
    room.players = room.players.filter(item => item !== player)
    if (!room.players.length) { clearTimeout(room.gameTimer); rooms.delete(room.id); return }
    if (room.hostId === player.id) room.hostId = (room.players.find(item => item.socket?.readyState === WebSocket.OPEN) ?? room.players[0]).id
    broadcast(room)
  }
  const enter = (socket: WebSocket, room: Room, player: Member) => {
    clearTimeout(player.expiry)
    if (player.socket) membership.delete(player.socket)
    player.socket = socket
    membership.set(socket, { room, player })
    syncGame(room)
    send(socket, { type: 'joined', room: snapshot(room, player.id), session: { roomId: room.id, playerId: player.id, token: player.token } })
    broadcast(room)
  }
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url?.split('?')[0] !== '/lobby') return
    // Same-origin browser connections only; non-browser clients support local tests.
    if (request.headers.origin) {
      try {
        if (new URL(request.headers.origin).host !== request.headers.host) { socket.destroy(); return }
      } catch { socket.destroy(); return }
    }
    wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client, request))
  }
  server.on('upgrade', upgrade)
  wss.on('connection', socket => {
    let alive = true
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return }
      alive = false
      socket.ping()
    }, 15_000)
    heartbeat.unref()
    socket.on('pong', () => { alive = true })
    socket.on('error', () => socket.terminate())
    socket.on('message', (raw, binary) => {
      const fail = (code: string, message: string) => send(socket, { type: 'error', code, message })
      let message: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(raw.toString())
        if (binary || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
        message = parsed as Record<string, unknown>
      } catch { fail('invalid', 'Invalid lobby request.'); return }
      const current = membership.get(socket)
      if (message.type === 'create' || message.type === 'join' || message.type === 'resume') {
        if (current) { fail('already_joined', 'Leave your current lobby first.'); return }
        const room = typeof message.roomId === 'string' ? rooms.get(message.roomId) : undefined
        if (message.type === 'resume') {
          const player = room?.players.find(item => item.token === message.token)
          if (!room || !player) { fail('session_expired', 'Your lobby session expired. Join again or create a new room.'); return }
          if (player.socket?.readyState === WebSocket.OPEN) { fail('session_in_use', 'This player is already connected in another tab. Enter a name to join separately.'); return }
          enter(socket, room, player)
          return
        }
        const name = typeof message.name === 'string' ? message.name.trim() : ''
        if (!name || name.length > 24) { fail('name', 'Enter a name between 1 and 24 characters.'); return }
        const player: Member = { id: randomUUID(), name, token: randomUUID(), socket: null }
        if (message.type === 'create') {
          if (rooms.size >= 100) { fail('busy', 'The local server is full. Try again later.'); return }
          const created: Room = { id: randomBytes(8).toString('hex'), hostId: player.id, players: [player] }
          rooms.set(created.id, created)
          enter(socket, created, player)
        } else {
          if (!room) { fail('not_found', 'This room no longer exists. Ask the host for a new invite.'); return }
          if (room.game) { fail('in_progress', 'This game has already started. Wait for a new lobby.'); return }
          if (room.players.length >= MAX_PLAYERS) { fail('full', 'This room is full (8 players).'); return }
          room.players.push(player)
          enter(socket, room, player)
        }
        return
      }
      if (!current) { fail('not_joined', 'Join a room first.'); return }
      syncGame(current.room)
      if (message.type === 'leave') {
        remove(current.room, current.player)
        send(socket, { type: 'left' })
      } else if (message.type === 'start') {
        if (current.room.hostId !== current.player.id) { fail('host_only', 'Only the host can start the game.'); return }
        if (!canStart(snapshot(current.room))) { fail('too_few', 'At least two connected players are needed.'); return }
        if (current.room.game) { fail('in_progress', 'This game has already started.'); return }
        current.room.game = createGame(current.room.players.filter(player => player.socket?.readyState === WebSocket.OPEN))
        send(socket, { type: 'ack' })
        broadcast(current.room)
      } else if (message.type === 'reveal') {
        if (current.room.hostId !== current.player.id) { fail('host_only', 'Only the host can control the reveal.'); return }
        const game = current.room.game
        try {
          if (!game || message.gameId !== game.id) throw new Error('This request belongs to a different game.')
          controlReveal(game, message.action, message.revision)
          broadcast(current.room)
          send(socket, { type: 'ack' })
        } catch (error) { fail('game', error instanceof Error ? error.message : 'Unable to update the reveal.') }
      } else if (['prompt', 'draft', 'submit_song'].includes(String(message.type))) {
        const game = current.room.game
        if (!game) { fail('no_game', 'Start a game first.'); return }
        try {
          if (message.gameId !== game.id) throw new Error('This request belongs to a different game.')
          if (message.type === 'prompt') submitPrompt(game, current.player.id, message.prompt, Date.now(), musicDuration)
          else saveSong(game, current.player.id, message.song, message.type === 'submit_song', Date.now(), false, Number(message.round), message.automatic === true)
          syncGame(current.room)
          if (message.type === 'draft') {
            send(socket, { type: 'draft_saved', revision: typeof message.revision === 'number' ? message.revision : 0 })
          } else {
            broadcast(current.room)
            send(socket, { type: 'ack' })
          }
        } catch (error) {
          fail('game', error instanceof Error ? error.message : 'Unable to save this turn.')
          syncGame(current.room)
          broadcast(current.room)
        }
      } else fail('invalid', 'Unknown lobby request.')
    })
    socket.on('close', () => {
      clearInterval(heartbeat)
      const current = membership.get(socket)
      if (!current || closed) return
      membership.delete(socket)
      current.player.socket = null
      broadcast(current.room)
      current.player.expiry = setTimeout(() => remove(current.room, current.player), graceMs)
      current.player.expiry.unref()
    })
  })
  const close = () => {
    if (closed) return
    closed = true
    server.off('upgrade', upgrade)
    for (const room of rooms.values()) { clearTimeout(room.gameTimer); for (const player of room.players) clearTimeout(player.expiry) }
    for (const socket of wss.clients) socket.terminate()
    wss.close()
    rooms.clear()
    membership.clear()
  }
  server.once('close', close)
  return { close }
}
