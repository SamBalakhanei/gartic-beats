import { useEffect, useRef, useState } from 'react'
import { DrumMachine } from '../music/DrumMachine'
import { emptyPattern } from '../music/pattern'
import { songVocals } from '../music/arrangement'
import type { GameView } from './types'

type Props = { game: GameView; isHost: boolean; hostName: string; hostConnected: boolean; connected: boolean; pending: boolean; send: (type: string, extra?: Record<string, unknown>) => void }
export default function Results({ game, isHost, hostName, hostConnected, connected, pending, send }: Props) {
  const engine = useRef<DrumMachine | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [needsInteraction, setNeedsInteraction] = useState(false)
  const [retry, setRetry] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [visible, setVisible] = useState(!document.hidden)
  const title = useRef<HTMLElement>(null)
  const result = game.results[0]
  const history = game.revealHistory

  const latest = useRef(result); latest.current = result
  const state = useRef({ connected, revision: game.reveal.revision }); state.current = { connected, revision: game.reveal.revision }
  useEffect(() => {
    const machine = new DrumMachine(emptyPattern(), () => {}, setPlaying)
    engine.current = machine
    const visibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', visibility)
    return () => { machine.dispose(); engine.current = null; document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    title.current?.focus({ preventScroll: true })
  }, [game.reveal.index])
  useEffect(() => {
    let current = true
    const machine = engine.current!
    machine.stop(); setError(''); setNeedsInteraction(false)
    const blockedTimer = setTimeout(() => {
      if (current && enabled && connected && visible && game.reveal.playing && machine.needsInteraction) setNeedsInteraction(true)
    }, 1500)
    if (!game.audioPending && enabled && connected && visible && game.reveal.playing && latest.current) void machine.start(latest.current.song).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Unable to play this song.') })
    return () => { current = false; clearTimeout(blockedTimer); machine.stop() }
  }, [game.reveal.index, game.reveal.revision, game.reveal.playing, enabled, connected, visible, game.audioPending, retry])
  function control(action: string) { send('reveal', { gameId: game.id, revision: game.reveal.revision, action }) }
  async function enable(andPlay = false) {
    const revision = game.reveal.revision
    setUnlocking(true); setError('')
    try {
      await engine.current?.prepare()
      if (!engine.current) return
      setEnabled(true); setNeedsInteraction(false); setRetry(value => value + 1)
      if (andPlay && state.current.connected && state.current.revision === revision) control('play')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to enable sound.') }
    finally { setUnlocking(false) }
  }
  if (!result) return <p role="status">Preparing the reveal…</p>
  const disabled = !connected || pending || unlocking
  const last = game.reveal.index === game.revealTotal - 1
  return <section className="reveal-stage" aria-label="Shared song reveal">
    <div className="reveal-progress"><span role="status">Chain {result.chainIndex + 1} of {game.total} · {result.contribution === 0 ? "Original prompt" : `Part ${result.contribution} of ${result.contributionTotal}`}{last ? ' · Final contribution' : ''}</span><span>{isHost ? 'You’re hosting' : `${hostName} is hosting`}</span></div>
    <progress max={game.revealTotal} value={game.reveal.index + 1} aria-label="Reveal progress" />
    <section className="reveal-conversation" key={result.chainIndex} aria-label={`Prompt ${result.chainIndex + 1} conversation`}>
      <header className={`conversation-prompt ${result.contribution === 0 ? 'is-current' : ''}`} ref={result.contribution === 0 ? title : undefined} tabIndex={result.contribution === 0 ? -1 : undefined}>
        <div className="message-author"><strong>{result.promptAuthor}</strong><span>started this idea</span><small>Prompt {result.chainIndex + 1}</small></div>
        <blockquote>“{result.prompt}”</blockquote>
      </header>
      <ol className={`conversation-parts ${game.rounds > 4 ? 'many-parts' : ''}`} aria-label="Contributions in order">
        {Array.from({ length: game.rounds }, (_, i) => {
          const number = i + 1
          const entry = history.find(item => item.chainIndex === result.chainIndex && item.contribution === number)
          const active = number === result.contribution
          return <li key={number} className={`conversation-part ${active ? 'is-current' : ''} ${entry ? '' : 'is-unrevealed'}`}>
            <span className="part-number" aria-hidden="true">{number}</span>
            <article ref={active ? title : undefined} tabIndex={active ? -1 : undefined} aria-label={entry ? `${entry.name}, part ${number}` : `Part ${number}, not revealed yet`}>
              {entry ? <><div className="message-author"><strong>{entry.name}</strong><span>{active && playing ? '♫ Playing' : `Part ${number}`}</span></div>
                <p>{(960 / entry.bpm).toFixed(1)}s · {entry.bpm} BPM{entry.automatic ? ' · Auto-saved' : ''}</p></> : <><strong>Part {number}</strong><p>Waiting to be revealed</p></>}
            </article>
          </li>
        })}
      </ol>
      <p className="conversation-status" role="status">{result.contribution === 0 ? 'The starting idea. The host reveals each contribution next.' : game.audioPending ? 'Waiting for this player’s recordings…' : playing ? `Now playing ${result.name}’s section` : needsInteraction ? 'Your browser paused audio. Tap Resume sound to listen.' : !enabled ? 'Muted on your device.' : game.reveal.playing && !visible ? 'Playback resumes when you return.' : `${result.name}’s section · ${songVocals(result.song).length} vocal clips · ${result.song.piano?.notes.length ?? 0} piano notes`}</p>
    </section>
    <div className="reveal-sound"><button className="secondary-button" disabled={!connected || unlocking} onClick={() => needsInteraction || !enabled ? void enable() : setEnabled(false)}>{unlocking ? 'Starting sound…' : needsInteraction ? 'Resume sound' : enabled ? 'Mute on my device' : 'Unmute on my device'}</button></div>
    {isHost ? <div className="reveal-controls" aria-label="Host reveal controls">
      <button className="secondary-button" disabled={disabled || game.reveal.index === 0} onClick={() => control('previous')}>← Previous</button>
      <button className="play-button" disabled={disabled || result.contribution === 0 || !!game.audioPending && !game.reveal.playing} onClick={() => game.reveal.playing ? control('stop') : void enable(true)}>{game.reveal.playing ? 'Stop for everyone' : 'Play for everyone'}</button>
      <button className="secondary-button" disabled={disabled || last} onClick={() => control('next')}>Next reveal →</button>
    </div> : <p className="reveal-wait" role="status">{!hostConnected ? 'The host disconnected. Waiting for them to return or a new host to take over…' : `Follow along—${hostName} controls playback and the next reveal.`}</p>}
    {last && <p className="reveal-wait">That’s everyone! {isHost ? 'Use Previous to revisit a song.' : 'The host can revisit any song.'}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
