import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { EventEmitter } from 'node:events'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { canStart, MAX_PLAYERS } from '../src/lobby/lobby.ts'
import type { Lobby, ServerMessage } from '../src/lobby/lobby.ts'

type Member = { id: string; name: string; token: string; socket: WebSocket | null; expiry?: ReturnType<typeof setTimeout> }
type Room = { id: string; hostId: string; players: Member[] }

export function attachLobbyServer(server: EventEmitter, graceMs = 30_000) {
  const rooms = new Map<string, Room>()
  const membership = new Map<WebSocket, { room: Room; player: Member }>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 })
  let closed = false
  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
  const snapshot = (room: Room): Lobby => ({
    id: room.id, hostId: room.hostId,
    players: room.players.map(player => ({ id: player.id, name: player.name, connected: player.socket?.readyState === WebSocket.OPEN })),
  })
  const broadcast = (room: Room, message: ServerMessage = { type: 'room', room: snapshot(room) }) => {
    for (const player of room.players) if (player.socket) send(player.socket, message)
  }
  const remove = (room: Room, player: Member) => {
    clearTimeout(player.expiry)
    if (player.socket) membership.delete(player.socket)
    room.players = room.players.filter(item => item !== player)
    if (!room.players.length) { rooms.delete(room.id); return }
    if (room.hostId === player.id) room.hostId = (room.players.find(item => item.socket?.readyState === WebSocket.OPEN) ?? room.players[0]).id
    broadcast(room)
  }
  const enter = (socket: WebSocket, room: Room, player: Member) => {
    clearTimeout(player.expiry)
    if (player.socket) membership.delete(player.socket)
    player.socket = socket
    membership.set(socket, { room, player })
    send(socket, { type: 'joined', room: snapshot(room), session: { roomId: room.id, playerId: player.id, token: player.token } })
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
          if (room.players.length >= MAX_PLAYERS) { fail('full', 'This room is full (8 players).'); return }
          room.players.push(player)
          enter(socket, room, player)
        }
        return
      }
      if (!current) { fail('not_joined', 'Join a room first.'); return }
      if (message.type === 'leave') {
        remove(current.room, current.player)
        send(socket, { type: 'left' })
      } else if (message.type === 'start') {
        if (current.room.hostId !== current.player.id) { fail('host_only', 'Only the host can start the game.'); return }
        if (!canStart(snapshot(current.room))) { fail('too_few', 'At least two connected players are needed.'); return }
        broadcast(current.room, { type: 'notice', message: 'The host is ready to start! Game rounds are coming next.' })
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
    for (const room of rooms.values()) for (const player of room.players) clearTimeout(player.expiry)
    for (const socket of wss.clients) socket.terminate()
    wss.close()
    rooms.clear()
    membership.clear()
  }
  server.once('close', close)
  return { close }
}
