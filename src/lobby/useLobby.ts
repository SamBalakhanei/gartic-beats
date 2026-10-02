import { useEffect, useRef, useState } from 'react'
import type { Lobby, ServerMessage, Session } from './lobby'

const storageKey = 'beat-telephone-session'
function readSession(): Session | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
    const invite = new URLSearchParams(location.search).get('room')
    return data && typeof data.roomId === 'string' && typeof data.token === 'string' && typeof data.playerId === 'string' && (!invite || invite === data.roomId) ? data : null
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
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [session, setSession] = useState(readSession)
  const sessionRef = useRef(session)
  const socket = useRef<WebSocket | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [connectionVersion, setConnectionVersion] = useState(0)
  const [status, setStatus] = useState('Connecting to lobby server…')
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [savedRevision, setSavedRevision] = useState(0)
  const [invite, setInvite] = useState(new URLSearchParams(location.search).get('room') ?? '')

  useEffect(() => {
    let disposed = false
    let retry: ReturnType<typeof setTimeout>
    let attempts = 0
    const connect = () => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lobby`)
      socket.current = ws
      ws.onopen = () => {
        if (disposed || socket.current !== ws) return
        attempts = 0
        setConnected(true)
        setStatus('Connected')
        if (sessionRef.current) {
          setPending(true)
          ws.send(JSON.stringify({ type: 'resume', ...sessionRef.current }))
          timeout.current = setTimeout(() => ws.close(), 8000)
        }
      }
      ws.onmessage = event => {
        if (disposed || socket.current !== ws) return
        const message = JSON.parse(event.data) as ServerMessage
        if (message.type !== 'room' && message.type !== 'draft_saved') { setPending(false); clearTimeout(timeout.current) }
        if (message.type === 'joined') {
          sessionRef.current = message.session
          saveSession(message.session)
          setSession(message.session)
          setLobby(message.room)
          setInvite(message.room.id)
          updateInvite(message.room.id)
          setNotice(message.room.game ? 'Reconnected to your game.' : 'You’re in. Share the invite link to bring friends in.')
        } else if (message.type === 'room') setLobby(message.room)
        else if (message.type === 'draft_saved') setSavedRevision(message.revision)
        else if (message.type === 'notice') setNotice(message.message)
        else if (message.type === 'left' || message.type === 'error' && ['session_expired', 'session_in_use'].includes(message.code)) {
          sessionRef.current = null
          saveSession(null)
          setSession(null)
          setLobby(null)
          if (message.type === 'left') { setInvite(''); updateInvite(); setNotice('You left the lobby.') }
          else setNotice(message.message)
        } else if (message.type === 'error') setNotice(message.message)
      }
      ws.onclose = () => {
        if (disposed || socket.current !== ws) return
        setConnected(false)
        setPending(false)
        clearTimeout(timeout.current)
        setStatus('Connection lost. Reconnecting…')
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 5000))
      }
      ws.onerror = () => ws.close()
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(retry)
      clearTimeout(timeout.current)
      socket.current?.close()
    }
  }, [connectionVersion])

  function goHome() {
    const previous = socket.current
    // Invalidate the old connection before queued joined/room messages arrive.
    socket.current = null
    sessionRef.current = null
    saveSession(null)
    clearTimeout(timeout.current)
    setSession(null); setLobby(null); setInvite(''); setNotice(''); setSavedRevision(0)
    setPending(false); setConnected(false); setStatus('Connecting to lobby server…')
    if (previous?.readyState === WebSocket.OPEN) previous.send(JSON.stringify({ type: 'leave' }))
    previous?.close()
    history.replaceState(null, '', '/home')
    setConnectionVersion(version => version + 1)
  }

  function send(type: string, extra: Record<string, unknown> = {}) {
    if (socket.current?.readyState !== WebSocket.OPEN || pending) return
    setNotice('')
    setPending(true)
    socket.current.send(JSON.stringify({ type, ...extra }))
    timeout.current = setTimeout(() => {
      setNotice('The server did not respond. Reconnecting…')
      socket.current?.close()
    }, 8000)
  }
  function saveDraft(extra: Record<string, unknown>) {
    if (socket.current?.readyState !== WebSocket.OPEN) return false
    socket.current.send(JSON.stringify({ type: 'draft', ...extra }))
    return true
  }
  function clearInvite() { setInvite(''); updateInvite(); setNotice('') }
  return { lobby, session, invite, connected, pending, notice, status, send, saveDraft, savedRevision, clearInvite, setNotice, goHome }
}
