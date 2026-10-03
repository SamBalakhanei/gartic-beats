import Brand from './Brand'
import { useEffect, useRef, useState } from 'react'
import Studio from './Studio'
import GameScreen from './game/GameScreen'
import { canStart, MAX_PLAYERS } from './lobby/lobby'
import { useLobby } from './lobby/useLobby'

export default function App() {
  const [sandbox, setSandbox] = useState(window.location.hash === '#sandbox')
  const [visitedStudio, setVisitedStudio] = useState(sandbox)
  const { lobby, session, invite, connected, pending, notice, status, send, updateSong, shareRecording, submitCurrent, clearInvite, setNotice, goHome } = useLobby()
  const [guestName, setGuestName] = useState('')
  const [motionPaused, setMotionPaused] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const roomPanel = useRef<HTMLElement>(null)

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
      {lobby?.game && <GameScreen onHome={home} isHost={!!isHost} hostName={lobby.players.find(player => player.id === lobby.hostId)?.name ?? 'Host'} hostConnected={!!lobby.players.find(player => player.id === lobby.hostId)?.connected} key={lobby.game.id} game={lobby.game} connected={connected} pending={pending} notice={notice} send={send} updateSong={updateSong} shareRecording={shareRecording} submitCurrent={submitCurrent} />}
      <main className={`app landing-page ${lobby ? 'has-room' : ''} ${motionPaused ? 'motion-paused' : ''}`} hidden={sandbox || !!lobby?.game}>
        <div className="landing-atmosphere" aria-hidden="true"><div className="ambient-glow glow-lime" /><div className="ambient-glow glow-purple" /><div className="ambient-rings"><i /><i /><i /></div></div>
        <header className="brand-row">
          <Brand onHome={home} />
          <nav className="landing-nav" aria-label="Main navigation"><a href="#how-to-play">How to play</a></nav>
        </header>
        <div className="landing-hero">
          <section className="landing-story">
            <p className="landing-kicker"><span aria-hidden="true" /> A music party for your group chat</p>
            <h1 ref={heading} tabIndex={-1}>{lobby ? <>Your band.<br /><em>Assemble.</em></> : <>The music game<br /><em>for your group chat.</em></>}</h1>
            <p className="landing-description">{lobby ? 'Send the invite. Get everyone in. Let the questionable musical decisions begin.' : 'Create a private game for 2–8 friends. Turn silly prompts into songs, take turns adding a section, then reveal what everyone made.'}</p>
            <div className="hero-game-row"><button className="hero-game-button" onClick={() => { if (lobby) roomPanel.current?.focus(); else nameInput.current?.focus() }}>{lobby ? 'Your lobby' : invite ? 'Join game' : 'Create game'} <span aria-hidden="true">→</span></button><span>{lobby ? 'Invite your friends and get ready.' : invite ? 'Your friends are waiting.' : 'Start a room. Share the link.'}<br />No accounts needed.</span></div>
            <div className="landing-facts"><span>2–8 friends</span><span>Free to play</span><span>No musical skills required</span></div>
            <div className="idea-demo" aria-label="Example: a cat in a jazz club becomes a song made by three friends">
              <div className="demo-caption"><span>ONE IDEA. EVERYONE’S SOUND.</span><span aria-hidden="true">↘</span></div>
              <div className="demo-prompt"><span aria-hidden="true">✳</span><p>“A cat sneaking into<br />a jazz club.”</p><small>the prompt</small></div>
              <div className="demo-song" aria-hidden="true">
                {[['01', 'The entrance', 'sneaky drums'], ['02', 'The plot twist', 'a piano detour'], ['03', 'The finale', 'questionable vocals']].map(([number, name, detail], index) => <div className={`demo-part demo-part-${index}`} key={number}><span>{number}</span><div className="demo-wave">{Array.from({ length: 15 }, (_, i) => <i key={i} style={{ height: `${20 + ((i * 17 + index * 23) % 70)}%` }} />)}</div><strong>{name}</strong><small>{detail}</small></div>)}
              </div>
              <p className="demo-footnote">Nobody knows where this is going. That’s the point.</p>
            </div>
          </section>
          <section ref={roomPanel} tabIndex={-1} className="home-card lobby-card" aria-labelledby="lobby-title">
            <div className="card-heading"><h2 id="lobby-title">{lobby ? 'The green room' : invite ? 'You’re on the guest list.' : 'Get the band together.'}</h2>{lobby && <span className="badge">{lobby.players.length} / {MAX_PLAYERS} players</span>}</div>
            {lobby ? <>
              <p className="card-note" role="status">{status}</p>
              <label className="invite-label" htmlFor="invite-link">Invite friends</label>
              <div className="guest-input-row"><input id="invite-link" readOnly value={inviteLink} onFocus={event => event.target.select()} /><button className="secondary-button" onClick={() => void copyInvite()}>Copy link</button></div>
              <ul className="player-list" aria-label="Lobby players">
                {lobby.players.map((player, index) => <li key={player.id}>
                  <span className="player-avatar" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span className="player-name">{player.name}{player.id === session?.playerId ? ' (you)' : ''}<small className="player-connection">{player.connected && connected ? player.peerReady ? 'Audio connection ready' : 'Checking direct audio connection…' : 'Reconnecting…'}</small></span>
                  {player.id === lobby.hostId && <span className="host-label">Host</span>}
                </li>)}
              </ul>
              {isHost && <button className="play-button home-primary" onClick={() => send('start')} disabled={!connected || pending || !canStart(lobby)} aria-describedby="start-help">Start game</button>}
              <p id="start-help" className="card-note">{!isHost ? 'Waiting for the host to start.' : canStart(lobby) ? 'Ready to start writing prompts.' : 'Need 2 players and working direct audio connections. If checking never completes, try another network or rejoin.'}</p>
              <p className="local-note">No cloud audio storage · Keep your tab open through the reveal. Direct connections may not work on every network.</p>
              <button className="text-button" disabled={!connected || pending} onClick={() => send('leave')}>Leave lobby</button>
            </> : <>
              <p>{invite ? 'You’re invited! Enter your name to join the lobby.' : 'Pick a name. Start a room. Send the link.'}</p>
              <form className="guest-form" onSubmit={event => {
                event.preventDefault()
                send(invite ? 'join' : 'create', { name: guestName, roomId: invite })
              }}>
                <label htmlFor="guest-name">Your name</label>
                <div className="guest-input-row"><input ref={nameInput} id="guest-name" value={guestName} onChange={event => setGuestName(event.target.value)} maxLength={24} placeholder="Your stage name" autoComplete="nickname" required /></div>
                <button className="play-button home-primary" disabled={!connected || pending || !guestName.trim()} type="submit">{pending ? 'Connecting…' : invite ? 'Join lobby' : 'Create game →'}</button>
              </form>
              {invite && <button className="text-button" disabled={pending} onClick={clearInvite}>Create a different lobby</button>}
              <p className="card-note" role="status">{status} · 2–8 players</p>
            </>}
          </section>
        </div>
        <section className="landing-bottom" id="how-to-play" aria-label="How to play and sandbox">
          <div className="landing-how"><p className="eyebrow">The less serious side of making music</p><h2>One prompt. A group effort.</h2><ol>
            <li><span>01</span><div><strong>Start something silly.</strong><p>Everyone writes a prompt. Someone else makes the opening section.</p></div></li>
            <li><span>02</span><div><strong>Follow your ears.</strong><p>The prompt disappears. Listen to the song so far and add what comes next.</p></div></li>
            <li><span>03</span><div><strong>Hear what happened.</strong><p>Reveal the original idea and everyone’s contribution. Blame your friends.</p></div></li>
          </ol></div>
          <aside className="landing-sandbox" aria-labelledby="sandbox-title"><span className="sandbox-symbol" aria-hidden="true">♫</span><p className="eyebrow">Want to practice first?</p><h2 id="sandbox-title">Try the instruments.</h2><p>Get comfortable with drums, piano, and recording before your next game.</p><a className="sandbox-cta" href="#sandbox">Practice in Sandbox <span aria-hidden="true">↗</span></a><small>No room needed. No pressure.</small></aside>
        </section>
        <footer className="page-footer landing-footer"><p role="status">{notice}</p><button className="motion-toggle" aria-pressed={motionPaused} onClick={() => setMotionPaused(value => !value)}>{motionPaused ? 'Resume background motion' : 'Pause background motion'}</button><p>Made for friends. Best enjoyed slightly out of tune.</p></footer>
      </main>
      {visitedStudio && <div hidden={!sandbox || !!lobby?.game}><Studio onHome={home} active={sandbox && !lobby?.game} hasLobby={lobby !== null} /></div>}
    </>
  )
}
