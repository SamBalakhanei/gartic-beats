import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { DrumMachine } from './music/DrumMachine'
import { BARS, BPM, STEPS_PER_BAR, clearBar, createPreset, emptyPattern, instruments, toggleStep } from './music/pattern'
import type { Instrument, Pattern, Preset } from './music/pattern'

const presets: { id: Preset; label: string; description: string }[] = [
  { id: 'soul', label: 'Soul Chop', description: 'A laid-back pocket with syncopated kicks and skipping hats.' },
  { id: 'stadium', label: 'Stadium Glow', description: 'Big backbeats, layered claps, and a closing tom fill.' },
  { id: 'industrial', label: 'Industrial Stomp', description: 'Sparse kicks, metallic accents, and abrupt gaps.' },
]

export default function Studio({ active, hasLobby }: { active: boolean; hasLobby: boolean }) {
  const [pattern, setPattern] = useState(() => createPreset('soul'))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const patternRef = useRef(pattern)
  const history = useRef<Pattern[]>([])
  const machine = useRef<DrumMachine | null>(null)
  const [bar, setBar] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [step, setStep] = useState(-1)
  const [volume, setVolume] = useState(65)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('Soul Chop loaded. Make it your own.')

  useEffect(() => {
    const engine = new DrumMachine(patternRef.current, setStep, setPlaying)
    machine.current = engine
    const onHide = () => {
      if (document.hidden) {
        engine.stop()
        setMessage('Playback paused while this tab is hidden.')
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      engine.dispose()
      machine.current = null
    }
  }, [])

  useEffect(() => {
    if (!active) machine.current?.stop()
    else titleRef.current?.focus()
  }, [active])

  function apply(next: Pattern, description: string, remember = true) {
    if (remember) history.current = [...history.current.slice(-19), patternRef.current]
    patternRef.current = next
    machine.current?.setPattern(next)
    setPattern(next)
    setMessage(description)
  }

  function undo() {
    const previous = history.current.pop()
    if (previous) apply(previous, 'Last edit undone.', false)
  }

  async function togglePlayback() {
    if (playing) { machine.current?.stop(); return }
    setError('')
    setStarting(true)
    try { await machine.current?.start() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sound could not start. Please try again.') }
    finally { setStarting(false) }
  }

  async function preview(id: Instrument) {
    setError('')
    try { await machine.current?.preview(id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sound could not start. Please try again.') }
  }

  const playingBar = step < 0 ? -1 : Math.floor(step / STEPS_PER_BAR)
  const notes = instruments.reduce((count, { id }) => count + pattern[id].filter(Boolean).length, 0)
  const barIsEmpty = instruments.every(({ id }) => !pattern[id].slice(bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).some(Boolean))

  return (
    <main className="app">
      <header className="brand-row">
        <a className="brand" href="#home" aria-label="Beat Telephone home">beat<span>telephone</span><span className="brand-dot">.</span></a>
        <a className="secondary-button" href="#home">← Back to {hasLobby ? 'lobby' : 'home'}</a>
      </header>

      <section className="brief" aria-labelledby="task-title">
        <div>
          <p className="eyebrow">Your idea, in rhythm</p>
          <h1 id="task-title" ref={titleRef} tabIndex={-1}>Give this raccoon a beat.</h1>
          <p className="instructions">Tap the squares to add sounds. No music experience needed.</p>
        </div>
        <aside className="prompt">
          <span className="eyebrow">Practice prompt</span>
          <p>“A raccoon breaking into a nightclub”</p>
        </aside>
      </section>

      <section className="editor" aria-label="Drum editor">
        <div className="transport">
          <div className="playback-controls">
            <button className={`play-button ${playing ? 'is-playing' : ''}`} disabled={starting} onClick={() => void togglePlayback()}>
              <span aria-hidden="true">{playing ? '■' : '▶'}</span> {starting ? 'Starting…' : playing ? 'Stop' : 'Play beat'}
            </button>
            <div className="timing"><strong>{BPM} BPM</strong><span>4 bars · 8-second loop</span></div>
          </div>
          <label className="volume">Volume <input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={event => {
            const value = Number(event.target.value)
            setVolume(value)
            machine.current?.setVolume(value / 100)
          }} /><span>{volume}%</span></label>
        </div>

        <div className="bar-toolbar">
          <div className="bar-buttons" role="group" aria-label="Choose a bar to edit">
            {Array.from({ length: BARS }, (_, index) => (
              <button key={index} aria-pressed={bar === index} onClick={() => setBar(index)} className={`bar-button ${playingBar === index ? 'sounding' : ''}`}>
                Bar {index + 1}<span className="bar-light" aria-hidden="true" />
                {playingBar === index && <span className="sr-only">, playing</span>}
              </button>
            ))}
          </div>
          <span className="play-position">{playingBar < 0 ? 'Ready when you are' : `Playing bar ${playingBar + 1} of 4`}</span>
        </div>

        <div className="tracks">
          {instruments.map(({ id, name, hint, color }) => (
            <div className="track" key={id} style={{ '--track-color': color } as CSSProperties}>
              <button className="instrument" onClick={() => void preview(id)} aria-label={`Preview ${name}`}>
                <span className="instrument-icon" aria-hidden="true">♪</span>
                <span><strong>{name}</strong><small>{hint}</small></span>
                <span className="preview-icon" aria-hidden="true">▶</span>
              </button>
              <div className="beats">
                {Array.from({ length: 4 }, (_, beat) => (
                  <div className="beat" key={beat}>
                    <span className="beat-label" aria-hidden="true">{beat + 1}</span>
                    <div className="beat-steps">
                      {Array.from({ length: 4 }, (_, subdivision) => {
                        const localStep = beat * 4 + subdivision
                        const absoluteStep = bar * STEPS_PER_BAR + localStep
                        const on = pattern[id][absoluteStep]
                        return <button key={localStep}
                          className={`step ${on ? 'active' : ''} ${step === absoluteStep ? 'current' : ''}`}
                          aria-label={`${name}, bar ${bar + 1}, beat ${beat + 1}, step ${subdivision + 1}`}
                          aria-pressed={on}
                          onClick={() => apply(toggleStep(patternRef.current, id, absoluteStep), `${name}: bar ${bar + 1}, step ${localStep + 1} ${on ? 'removed' : 'added'}.`)}
                        ><span aria-hidden="true">{on ? '●' : ''}</span></button>
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="editor-footer">
          <p><span className="legend-square" aria-hidden="true" /> Lit squares make a sound. Tap an instrument to hear it.</p>
          <div className="edit-actions">
            <button onClick={undo} disabled={history.current.length === 0}>Undo</button>
            <button onClick={() => apply(clearBar(patternRef.current, bar), `Bar ${bar + 1} cleared. Undo brings it back.`)} disabled={barIsEmpty}>Clear bar</button>
            <button onClick={() => apply(emptyPattern(), 'Beat cleared. Start fresh, or undo to bring it back.')} disabled={notes === 0}>Clear all</button>
          </div>
        </div>
      </section>

      <section className="starters" aria-labelledby="starters-title">
        <div><h2 id="starters-title">Need a starting point?</h2><p>Replace all four bars with a pattern, then change anything.</p></div>
        <div className="preset-buttons">{presets.map(({ id, label, description }) => (
          <button key={id} title={description} onClick={() => apply(createPreset(id), `${label} loaded across all four bars. Undo restores your beat.`)}>{label}<span aria-hidden="true"> ↗</span></button>
        ))}</div>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="page-footer"><p role="status">{message}</p><p>Practice only · Edits reset on refresh</p></footer>
    </main>
  )
}
