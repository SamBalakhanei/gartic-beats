import { useEffect, useRef, useState } from 'react'
import { DrumMachine } from '../music/DrumMachine'
import { emptyPattern } from '../music/pattern'
import { songVocals } from '../music/arrangement'
import type { GameView } from './types'

type Props = { game: GameView; isHost: boolean; hostName: string; hostConnected: boolean; connected: boolean; pending: boolean; send: (type: string, extra?: Record<string, unknown>) => void }
export default function Results({ game, isHost, hostName, hostConnected, connected, pending, send }: Props) {
  const engine = useRef<DrumMachine | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [visible, setVisible] = useState(!document.hidden)
  const title = useRef<HTMLHeadingElement>(null)
  const result = game.results[0]
  const latest = useRef(result); latest.current = result
  const state = useRef({ connected, revision: game.reveal.revision }); state.current = { connected, revision: game.reveal.revision }
  useEffect(() => {
    const machine = new DrumMachine(emptyPattern(), () => {}, setPlaying)
    engine.current = machine
    const visibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => { machine.dispose(); engine.current = null; document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => { title.current?.focus() }, [game.reveal.index])
  useEffect(() => {
    let current = true
    const machine = engine.current!
    machine.stop(); setError('')
    if (enabled && connected && visible && game.reveal.playing && latest.current) void machine.start(latest.current.song).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Unable to play this song.') })
    return () => { current = false; machine.stop() }
  }, [game.reveal.index, game.reveal.revision, game.reveal.playing, enabled, connected, visible])
  function control(action: string) { send('reveal', { gameId: game.id, revision: game.reveal.revision, action }) }
  async function enable(andPlay = false) {
    const revision = game.reveal.revision
    setUnlocking(true); setError('')
    try {
      await engine.current?.prepare()
      if (!engine.current) return
      setEnabled(true)
      if (andPlay && state.current.connected && state.current.revision === revision) control('play')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to enable sound.') }
    finally { setUnlocking(false) }
  }
  if (!result) return <p role="status">Preparing the reveal…</p>
  const disabled = !connected || pending || unlocking
  const last = game.reveal.index === game.total - 1
  return <section className="reveal-stage" aria-label="Shared song reveal">
    <div className="reveal-progress"><span role="status">Song {game.reveal.index + 1} of {game.total}{last ? ' · Final song' : ''}</span><span>{isHost ? 'You’re hosting' : `${hostName} is hosting`}</span></div>
    <progress max={game.total} value={game.reveal.index + 1} aria-label="Reveal progress" />
    <article className="home-card reveal-card">
      <p className="eyebrow">Made by</p><h2 ref={title} tabIndex={-1}>{result.name}</h2>
      <blockquote>“{result.prompt}”</blockquote><p className="card-note">Prompt by {result.promptAuthor}</p>
      <div className={`reveal-disc ${playing ? 'playing' : ''}`} aria-hidden="true">♫</div>
      <p className="card-note">{result.song.bpm} BPM · {songVocals(result.song).length} vocal layers · {result.song.piano?.notes.length ?? 0} piano notes{result.automatic ? ' · Saved automatically' : ''}</p>
      <p role="status">{playing ? 'Now playing' : game.reveal.playing && !enabled ? 'The host is playing this song. Enable sound to listen.' : game.reveal.playing && !visible ? 'Playback resumes when you return.' : 'Ready to listen'}</p>
      <button className="secondary-button" disabled={!connected || unlocking} onClick={() => enabled ? setEnabled(false) : void enable()}>{unlocking ? 'Enabling…' : enabled ? 'Mute on my device' : 'Enable sound'}</button>
      {!result.song.piano?.notes.length && !songVocals(result.song).length && !Object.values(result.song.pattern).some(track => track.some(Boolean)) && <p className="card-note">No notes were added to this song.</p>}
    </article>
    {isHost ? <div className="reveal-controls" aria-label="Host reveal controls">
      <button className="secondary-button" disabled={disabled || game.reveal.index === 0} onClick={() => control('previous')}>← Previous</button>
      <button className="play-button" disabled={disabled} onClick={() => game.reveal.playing ? control('stop') : void enable(true)}>{game.reveal.playing ? 'Stop for everyone' : 'Play for everyone'}</button>
      <button className="secondary-button" disabled={disabled || last} onClick={() => control('next')}>Next song →</button>
    </div> : <p className="reveal-wait" role="status">{!hostConnected ? 'The host disconnected. Waiting for them to return or a new host to take over…' : `Follow along—${hostName} controls playback and the next reveal.`}</p>}
    {last && <p className="reveal-wait">That’s everyone! {isHost ? 'Use Previous to revisit a song.' : 'The host can revisit any song.'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
