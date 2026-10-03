import { useEffect, useRef, useState } from 'react'
import { emptyPattern } from '../music/pattern'
import type { VoiceTrack } from '../music/voice'
import { Peers } from '../p2p/Peers'
import type { Song } from '../game/types'
import type { Lobby, ServerMessage, Session } from './lobby'

const storageKey = 'beat-telephone-session'
function readSession(): Session | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
    const invite = new URLSearchParams(location.search).get('room')
    return data && typeof data.roomId === 'string' && /^[a-f0-9]{32}$/.test(data.roomId) && typeof data.token === 'string' && typeof data.playerId === 'string' && (!invite || invite === data.roomId) ? data : null
  } catch { return null }
}
function saveSession(value: Session | null) {
  try {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value))
    else sessionStorage.removeItem(storageKey)
  } catch { /* The live lobby still works if browser storage is unavailable. */ }
}
function updateInvite(roomId?: string) {
  const url = new URL(location.href)
  if (roomId) url.searchParams.set('room', roomId)
  else url.searchParams.delete('room')
  history.replaceState(null, '', url)
}

export function useLobby() {
  const rawRoom = useRef<Lobby | null>(null)
  const peers = useRef<Peers | null>(null)
  const opening = useRef<Record<string, unknown> | null>(null)
  const transferQueue = useRef(Promise.resolve())
  const sending = useRef(false)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [session, setSession] = useState(readSession)
  const sessionRef = useRef(session)
  const socket = useRef<WebSocket | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [connectionVersion, setConnectionVersion] = useState(0)
  const [status, setStatus] = useState('Ready to create or join a room')
  const [connected, setConnected] = useState(true)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const currentSong = useRef<{ gameId: unknown; round: unknown; song: Song } | null>(null)
  const automaticTurn = useRef('')
  const flush = useRef<() => void>(() => {})
  flush.current = () => {
    const draft = currentSong.current, game = rawRoom.current?.game, ws = socket.current, manager = peers.current
    if (!draft || !manager || ws?.readyState !== WebSocket.OPEN || game?.phase !== 'music' || game.mine?.submitted || draft.gameId !== game.id || draft.round !== game.round) return
    const turn = `${game.id}:${game.round}`
    if (automaticTurn.current === turn) return
    try {
      ws.send(JSON.stringify({ type: 'submit_song', gameId: game.id, round: game.round, song: manager.snapshot(draft.song), automatic: true }))
      automaticTurn.current = turn
    } catch { /* Leaving a page is best effort; the server still advances on timeout. */ }
  }
  useEffect(() => {
    const leavePage = () => flush.current()
    window.addEventListener('pagehide', leavePage)
    return () => window.removeEventListener('pagehide', leavePage)
  }, [])
  const [invite, setInvite] = useState(new URLSearchParams(location.search).get('room') ?? '')

  function refreshRoom() {
    const room = rawRoom.current
    if (!room?.game || !peers.current) { setLobby(room); return }
    const game = room.game
    const own = game.mine ? peers.current.hydrate(game.mine.song) : null
    const results = game.results.map(result => ({ ...result, song: peers.current!.hydrate(result.song) }))
    setLobby({ ...room, game: { ...game,
      audioPending: game.phase === 'music' ? !!game.mine && !own : results.some(result => !result.song),
      mine: game.mine ? { ...game.mine, song: own ?? game.mine.song } : null,
      results: game.results.map((result, index) => ({ ...result, song: results[index].song ?? result.song })),
    } })
  }

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout>
    let heartbeat: ReturnType<typeof setInterval>
    let attempts = 0
    const manager = new Peers(message => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message))
    }, refreshRoom, setNotice)
    peers.current = manager
    const connect = () => {
      const roomId = sessionRef.current?.roomId ?? String(opening.current?.roomId ?? '')
      if (!roomId) { setConnected(true); setStatus('Ready to create or join a room'); return }
      setPending(true); sending.current = true
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lobby?room=${encodeURIComponent(roomId)}`)
      socket.current = ws
      timeout.current = setTimeout(() => ws.close(), 10_000)
      ws.onopen = () => {
        if (disposed || socket.current !== ws) return
        attempts = 0
        setConnected(true)
        setStatus('Connected · Checking direct audio connections')
        const request = sessionRef.current ? { type: 'resume', ...sessionRef.current } : opening.current
        if (request) ws.send(JSON.stringify(request))
        heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping') }, 25_000)
      }
      ws.onmessage = event => {
        if (disposed || socket.current !== ws || event.data === 'pong') return
        const message = JSON.parse(event.data) as ServerMessage
        if (message.type === 'signal') { manager.signal(message.from, message.signal); return }
        if (message.type !== 'room' && message.type !== 'draft_saved') { sending.current = false; setPending(false); clearTimeout(timeout.current) }
        if (message.type === 'joined') {
          opening.current = null
          sessionRef.current = message.session
          saveSession(message.session)
          setSession(message.session)
          rawRoom.current = message.room
          manager.sync(message.room, message.session.playerId)
          manager.report()
          refreshRoom()
          setInvite(message.room.id)
          updateInvite(message.room.id)
          setNotice('Keep this tab open. Recordings are shared directly with other players; there is no cloud audio backup.')
        } else if (message.type === 'room') {
          rawRoom.current = message.room
          if (sessionRef.current) manager.sync(message.room, sessionRef.current.playerId)
          refreshRoom()
        } else if (message.type === 'notice') setNotice(message.message)
        else if (message.type === 'left' || message.type === 'error' && ['session_expired', 'session_in_use'].includes(message.code)) {
          sessionRef.current = null; opening.current = null
          saveSession(null)
          setSession(null); rawRoom.current = null; setLobby(null); manager.reset()
          if (message.type === 'left') { setInvite(''); updateInvite(); setNotice('You left the lobby.') }
          else setNotice(message.message)
          // No idle socket is needed on the home screen.
          socket.current = null; ws.close(); clearInterval(heartbeat)
          setConnected(true); setStatus('Ready to create or join a room')
        } else if (message.type === 'error') setNotice(message.message)
      }
      ws.onclose = () => {
        if (disposed || socket.current !== ws) return
        clearInterval(heartbeat); clearTimeout(timeout.current)
        sending.current = false; setPending(false)
        if (!sessionRef.current) {
          opening.current = null; socket.current = null; setConnected(true)
          setStatus('Ready to retry'); setNotice('Could not join. The room may have expired, the free quota may be exhausted, or the network may be unavailable.')
          return
        }
        setConnected(false); setStatus('Connection lost. Reconnecting…')
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 30_000))
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(retry); clearTimeout(timeout.current); clearInterval(heartbeat)
      manager.close(); socket.current?.close()
    }
  }, [connectionVersion])

  function goHome() {
    flush.current()
    currentSong.current = null
    const previous = socket.current
    // Invalidate the old connection before queued joined/room messages arrive.
    socket.current = null
    sessionRef.current = null
    rawRoom.current = null; opening.current = null; sending.current = false; transferQueue.current = Promise.resolve()
    saveSession(null)
    clearTimeout(timeout.current)
    setSession(null); setLobby(null); setInvite(''); setNotice('')
    setPending(false); setConnected(false); setStatus('Connecting to lobby server…')
    if (previous?.readyState === WebSocket.OPEN) previous.send(JSON.stringify({ type: 'leave' }))
    previous?.close()
    history.replaceState(null, '', '/home')
    setConnectionVersion(version => version + 1)
  }

  function send(type: string, extra: Record<string, unknown> = {}) {
    if (sending.current) return
    if (type === 'create' || type === 'join') {
      const roomId = type === 'create' ? crypto.randomUUID().replaceAll('-', '') : String(extra.roomId)
      if (!/^[a-f0-9]{32}$/.test(roomId)) { setNotice('This invite is invalid. Ask for a new link.'); return }
      opening.current = { type, ...extra, roomId }
      sending.current = true; setPending(true); setNotice('Connecting…')
      setConnectionVersion(version => version + 1)
      return
    }
    if (socket.current?.readyState !== WebSocket.OPEN) return
    setNotice(''); setPending(true); sending.current = true
    const ws = socket.current
    const manager = peers.current
    transferQueue.current = transferQueue.current.catch(() => {}).then(async () => {
      let payload = extra
      if (type === 'submit_song' && manager) {
        setNotice('Sharing your recordings with the other players… Keep this tab open.')
        const { layers: _backing, ...part } = extra.song as Song
        const song = await manager.prepare(part)
        await manager.shared(song)
        payload = { ...extra, song }
      }
      if (socket.current !== ws || ws.readyState !== WebSocket.OPEN) throw new Error('Reconnect before submitting.')
      ws.send(JSON.stringify({ type, ...payload }))
      timeout.current = setTimeout(() => { setNotice('The server did not respond. Reconnecting…'); ws.close() }, 8000)
    }).catch(error => { if (socket.current !== ws) return; sending.current = false; setPending(false); setNotice(error instanceof Error ? error.message : 'Unable to share song.') })
  }
  function updateSong(extra: Record<string, unknown>) {
    // A live reference for final submission only. No persistence or network work.
    currentSong.current = { gameId: extra.gameId, round: extra.round, song: extra.song as Song }
  }
  function shareRecording(voice: VoiceTrack) {
    const manager = peers.current
    if (manager) void manager.prepare({ pattern: emptyPattern(), bpm: voice.bpm, voice }).catch(error => {
      if (peers.current === manager) setNotice(error instanceof Error ? error.message : 'Recording could not be shared.')
    })
  }
  function submitCurrent() { flush.current() }
  function clearInvite() { setInvite(''); updateInvite(); setNotice('') }
  return { lobby, session, invite, connected, pending, notice, status, send, updateSong, shareRecording, submitCurrent, clearInvite, setNotice, goHome }
}
