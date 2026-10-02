import Brand from './Brand'
import { useEffect, useRef, useState } from 'react'
import Studio from './Studio'
import GameScreen from './game/GameScreen'
import { canStart, MAX_PLAYERS } from './lobby/lobby'
import { useLobby } from './lobby/useLobby'

export default function App() {
  const [sandbox, setSandbox] = useState(window.location.hash === '#sandbox')
  const [visitedStudio, setVisitedStudio] = useState(sandbox)
  const { lobby, session, invite, connected, pending, notice, status, send, saveDraft, savedRevision, clearInvite, setNotice, goHome } = useLobby()
  const [guestName, setGuestName] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const navigate = () => {
      const next = window.location.hash === '#sandbox'
      setSandbox(next)
      if (next) setVisitedStudio(true)
    }
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  useEffect(() => {
    if (!sandbox) heading.current?.focus()
  }, [sandbox, lobby !== null])

  const isHost = lobby?.hostId === session?.playerId
  const inviteLink = lobby ? `${location.origin}${location.pathname}?room=${lobby.id}` : ''

  function home() { goHome(); setSandbox(false); setVisitedStudio(false); setGuestName('') }

  async function copyInvite() {
    try { await navigator.clipboard.writeText(inviteLink); setNotice('Invite link copied.') }
    catch { setNotice('Select and copy the invite link below.') }
  }

  return (
    <>
      {lobby?.game && <GameScreen onHome={home} isHost={!!isHost} hostName={lobby.players.find(player => player.id === lobby.hostId)?.name ?? 'Host'} hostConnected={!!lobby.players.find(player => player.id === lobby.hostId)?.connected} key={lobby.game.id} game={lobby.game} connected={connected} pending={pending} notice={notice} savedRevision={savedRevision} send={send} saveDraft={saveDraft} />}
      <main className="app home-app" hidden={sandbox || !!lobby?.game}>
        <header className="brand-row">
          <Brand onHome={home} />
          <span className="badge">Make a little noise</span>
        </header>
        <section className="home-intro">
          <p className="eyebrow">Good friends. Questionable beats.</p>
          <h1 ref={heading} tabIndex={-1}>{lobby ? 'Get the band together.' : <>Pass the beat.<br /><span>Lose the plot.</span></>}</h1>
          <p>{lobby ? 'Your lobby is ready. Gather your players before the first round.' : 'Turn silly ideas into music, pass them around, and hear where they end up.'}</p>
        </section>
        <div className="home-panels">
          <section className="home-card lobby-card" aria-labelledby="lobby-title">
            <div className="card-heading"><h2 id="lobby-title">{lobby ? 'Your lobby' : 'Bring your friends'}</h2>{lobby && <span className="badge">{lobby.players.length} / {MAX_PLAYERS} players</span>}</div>
            {lobby ? <>
              <p className="card-note" role="status">{status}</p>
              <label className="invite-label" htmlFor="invite-link">Invite friends</label>
              <div className="guest-input-row"><input id="invite-link" readOnly value={inviteLink} onFocus={event => event.target.select()} /><button className="secondary-button" onClick={() => void copyInvite()}>Copy link</button></div>
              <ul className="player-list" aria-label="Lobby players">
                {lobby.players.map((player, index) => <li key={player.id}>
                  <span className="player-avatar" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span className="player-name">{player.name}{player.id === session?.playerId ? ' (you)' : ''}<small className="player-connection">{player.connected && connected ? 'Connected' : 'Reconnecting…'}</small></span>
                  {player.id === lobby.hostId && <span className="host-label">Host</span>}
                </li>)}
              </ul>
              {isHost && <button className="play-button home-primary" onClick={() => send('start')} disabled={!connected || pending || !canStart(lobby)} aria-describedby="start-help">Start game</button>}
              <p id="start-help" className="card-note">{!isHost ? 'Waiting for the host to start.' : canStart(lobby) ? 'Ready to start writing prompts.' : 'At least 2 connected players are needed to start.'}</p>
              <p className="local-note">Local server · Open the invite in another browser tab to join.</p>
              <button className="text-button" disabled={!connected || pending} onClick={() => send('leave')}>Leave lobby</button>
            </> : <>
              <p>{invite ? 'You’re invited! Enter your name to join the lobby.' : 'Create a lobby and share its link with your friends.'}</p>
              <form className="guest-form" onSubmit={event => {
                event.preventDefault()
                send(invite ? 'join' : 'create', { name: guestName, roomId: invite })
              }}>
                <label htmlFor="guest-name">Your name</label>
                <div className="guest-input-row"><input id="guest-name" value={guestName} onChange={event => setGuestName(event.target.value)} maxLength={24} placeholder="Guest name" autoComplete="nickname" required /></div>
                <button className="play-button home-primary" disabled={!connected || pending || !guestName.trim()} type="submit">{pending ? 'Connecting…' : invite ? 'Join lobby' : 'Create game'}</button>
              </form>
              {invite && <button className="text-button" disabled={pending} onClick={clearInvite}>Create a different lobby</button>}
              <p className="card-note" role="status">{status} · 2–8 players</p>
            </>}
          </section>
          <section className="home-card sandbox-card" aria-labelledby="sandbox-title">
            <div className="mini-sequencer" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <span key={index} className={[0, 3, 6, 10, 14, 17, 21, 23].includes(index) ? 'lit' : ''} />)}</div>
            <p className="eyebrow">Just you and the groove</p>
            <h2 id="sandbox-title">Find your sound.</h2>
            <p>Eight instruments and a few starting grooves to make your own. Play as long as you like.</p>
            <a className="secondary-button sandbox-link" href="#sandbox">Go to Sandbox <span aria-hidden="true">↗</span></a>
            <p className="card-note">No lobby needed. Your beat stays when you come back.</p>
          </section>
        </div>
        <footer className="page-footer"><p role="status">{notice}</p><p>Rooms last until the server restarts · Beats reset on refresh</p></footer>
      </main>
      {visitedStudio && <div hidden={!sandbox || !!lobby?.game}><Studio onHome={home} active={sandbox && !lobby?.game} hasLobby={lobby !== null} /></div>}
    </>
  )
}
