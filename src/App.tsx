import { useEffect, useRef, useState } from 'react'
import Studio from './Studio'
import { addPlayer, canStart, createLobby, MAX_PLAYERS, removePlayer } from './lobby/lobby'
import type { Lobby } from './lobby/lobby'

export default function App() {
  const [sandbox, setSandbox] = useState(window.location.hash === '#sandbox')
  const [visitedStudio, setVisitedStudio] = useState(sandbox)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [guestName, setGuestName] = useState('')
  const [notice, setNotice] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)

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

  function create() {
    setLobby(createLobby())
    setNotice('Lobby created. Add another player to get ready.')
  }

  function start() {
    if (!lobby || !canStart(lobby)) return
    setNotice('Your group is ready! Game rounds are coming in the next step.')
  }

  return (
    <>
      <main className="app home-app" hidden={sandbox}>
        <header className="brand-row">
          <a className="brand" href="#home" aria-label="Beat Telephone home">beat<span>telephone</span><span className="brand-dot">.</span></a>
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
              <ul className="player-list" aria-label="Lobby players">
                {lobby.players.map((player, index) => <li key={player.id}>
                  <span className="player-avatar" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <span className="player-name">{player.name}</span>
                  {player.id === lobby.hostId ? <span className="host-label">Host</span> : <button className="remove-player" onClick={() => {
                    setLobby(removePlayer(lobby, player.id))
                    setNotice(`${player.name} removed from the lobby.`)
                  }} aria-label={`Remove ${player.name}`}>Remove</button>}
                </li>)}
              </ul>
              <form className="guest-form" onSubmit={event => {
                event.preventDefault()
                if (!guestName.trim() || lobby.players.length >= MAX_PLAYERS) return
                setLobby(addPlayer(lobby, guestName, crypto.randomUUID()))
                setNotice(`${guestName.trim()} added to the lobby.`)
                setGuestName('')
                nameInput.current?.focus()
              }}>
                <label htmlFor="guest-name">Add a local player</label>
                <div className="guest-input-row"><input ref={nameInput} id="guest-name" value={guestName} onChange={event => setGuestName(event.target.value)} maxLength={24} placeholder="Guest name" autoComplete="off" disabled={lobby.players.length >= MAX_PLAYERS} />
                  <button className="secondary-button" type="submit" disabled={!guestName.trim() || lobby.players.length >= MAX_PLAYERS}>Add player</button></div>
              </form>
              <button className="play-button home-primary" onClick={start} disabled={!canStart(lobby)} aria-describedby="start-help">Start game</button>
              <p id="start-help" className="card-note">{canStart(lobby) ? 'Ready to start. Game rounds are coming next.' : 'At least 2 players are needed to start.'}</p>
              <p className="local-note">Local lobby preview · Online invites and joining come next.</p>
              <button className="text-button" onClick={() => { setLobby(null); setGuestName(''); setNotice('Lobby closed.') }}>Close lobby</button>
            </> : <>
              <p>A new lobby starts with you. Get your group ready for musical telephone.</p>
              <button className="play-button home-primary" onClick={create}>Create game</button>
              <p className="card-note">2–8 players · No musical experience needed</p>
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
        <footer className="page-footer"><p role="status">{notice}</p><p>Lobby and beat reset on refresh</p></footer>
      </main>
      {visitedStudio && <div hidden={!sandbox}><Studio active={sandbox} hasLobby={lobby !== null} /></div>}
    </>
  )
}
