import Results from './Results'
import { useEffect, useRef, useState } from 'react'
import Studio from '../Studio'
import { MAX_PROMPT_LENGTH } from './types'
import type { GameView, Song } from './types'

type Props = {
  isHost: boolean; hostName: string; hostConnected: boolean
  game: GameView; connected: boolean; pending: boolean; notice: string; savedRevision: number
  send: (type: string, extra?: Record<string, unknown>) => void
  saveDraft: (extra: Record<string, unknown>) => boolean
}

export default function GameScreen({ isHost, hostName, hostConnected, game, connected, pending, notice, savedRevision, send, saveDraft }: Props) {
  const [prompt, setPrompt] = useState(game.phase === 'prompts' ? game.mine?.prompt ?? '' : '')
  const [seconds, setSeconds] = useState(600)
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(savedRevision)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(draftTimer.current), [game.phase])
  const localDeadline = useRef<number | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [game.phase])
  useEffect(() => {
    localDeadline.current = game.deadline === null ? null : Date.now() + (game.deadline - game.serverNow)
    const update = () => setSeconds(localDeadline.current === null ? 600 : Math.max(0, Math.ceil((localDeadline.current - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 250)
    return () => clearInterval(timer)
  }, [game.deadline, game.serverNow])
  const mine = game.mine
  const disabled = !connected || pending
  const progress = `${game.completed} / ${game.total} ${game.phase === 'prompts' ? 'prompts' : 'songs'} submitted`
  const connectionNote = connected ? '' : 'Connection lost. Reconnecting… Your saved draft is safe on the server.'

  if (game.phase === 'music' && mine) {
    const locked = disabled || mine.submitted || seconds === 0
    return <Studio active hasLobby game={{
      initialSong: mine.song, prompt: mine.prompt ?? '', disabled: locked,
      toolbar: <div className="round-toolbar"><div><strong>{mine.submitted ? 'Song submitted. Waiting for the others…' : 'One prompt. One song. Make it yours.'}</strong><p>{progress}</p></div><button className="secondary-button" disabled={disabled} onClick={() => send('leave')}>Leave game</button><span className="round-clock" aria-label="Time remaining">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>{connectionNote && <p role="status">{connectionNote}</p>}{notice && <p role="status">{notice}</p>}</div>,
      saveStatus: mine.submitted ? 'Submitted — your song is locked in.' : !connected ? 'Offline — editing paused until you reconnect.' : seconds === 0 ? 'Time is up. Opening results…' : revision > savedRevision ? 'Saving…' : 'All changes saved.',
      onSongChange: (song: Song) => {
        const next = ++revisionRef.current
        setRevision(next)
        clearTimeout(draftTimer.current)
        draftTimer.current = setTimeout(() => saveDraft({ gameId: game.id, song, revision: next }), 200)
      },
      onSubmit: song => { clearTimeout(draftTimer.current); send('submit_song', { gameId: game.id, song }) },
    }} />
  }

  return <main className="app home-app">
    <header className="brand-row"><span className="brand">beat<span>telephone</span><span className="brand-dot">.</span></span><button className="secondary-button" disabled={disabled} onClick={() => send('leave')}>Leave game</button></header>
    <section className="home-intro"><p className="eyebrow">{game.phase === 'results' ? 'The listening party' : 'It starts with an idea'}</p><h1 ref={heading} tabIndex={-1}>{game.phase === 'results' ? 'Hear what happened.' : 'Write something worth a beat.'}</h1><p>{game.phase === 'results' ? 'One song at a time. The host leads the listening party.' : 'Give someone a scene, a mood, or something ridiculous. Your prompt will go to another player.'}</p></section>
    {game.phase === 'results' ? <Results game={game} isHost={isHost} hostName={hostName} hostConnected={hostConnected} connected={connected} pending={pending} send={send} /> : mine ? <section className="home-card">
      {mine.promptSubmitted ? <><h2>Prompt submitted!</h2><p>Waiting for everyone to finish writing. Your 10 minutes starts when all prompts are ready.</p></> : <form className="prompt-form" onSubmit={event => { event.preventDefault(); send('prompt', { gameId: game.id, prompt }) }}>
        <label htmlFor="game-prompt">Your prompt</label><textarea id="game-prompt" maxLength={MAX_PROMPT_LENGTH} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="A raccoon breaking into a nightclub" rows={4} required disabled={disabled} />
        <span>{prompt.length} / {MAX_PROMPT_LENGTH}</span><button className="play-button" disabled={disabled || !prompt.trim()}>Submit prompt</button>
      </form>}
      <p role="status">{progress}</p>
    </section> : <p>This round is already underway. You can listen when the results are ready.</p>}
    <footer className="page-footer"><p role="status">{connectionNote || notice}</p><p>One song per player</p></footer>
  </main>
}
