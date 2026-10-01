import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import VoiceRecorder from './music/VoiceRecorder'
import VocalLane from './music/VocalLane'
import type { VoiceTrack } from './music/voice'
import type { Song } from './game/types'
import { DrumMachine } from './music/DrumMachine'
import { DEFAULT_BPM, MIN_BPM, MAX_BPM, stepSeconds } from './music/tempo'
import { BARS, TOTAL_STEPS, STEPS_PER_BAR, clearBar, createPreset, emptyPattern, instruments, toggleStep } from './music/pattern'
import type { Instrument, Preset } from './music/pattern'
import { DEFAULT_MIX, MAX_VOCAL_LAYERS, MIN_SAMPLE_BPM, MAX_SAMPLE_BPM, songVocals } from './music/arrangement'
import type { VocalClip, Mix } from './music/arrangement'

type Arrangement = Song & { mix: Mix; vocals: VocalClip[] }
type GameStudio = {
  initialSong: Song; prompt: string; disabled: boolean; toolbar: ReactNode; saveStatus: string
  onSongChange: (song: Song) => void; onSubmit: (song: Song) => void
}
const presets: { id: Preset; label: string }[] = [
  { id: 'soul', label: 'Soul Chop' }, { id: 'stadium', label: 'Stadium Glow' }, { id: 'industrial', label: 'Industrial Stomp' },
]

export default function Studio({ active, hasLobby, game }: { active: boolean; hasLobby: boolean; game?: GameStudio }) {
  const titleId = useId()
  const [song, setSong] = useState<Arrangement>(() => {
    const initial = game?.initialSong ?? { pattern: createPreset('soul'), bpm: DEFAULT_BPM }
    return { pattern: initial.pattern, bpm: initial.bpm, mix: initial.mix ?? { ...DEFAULT_MIX }, vocals: songVocals(initial) }
  })
  const songRef = useRef(song)
  const history = useRef<Arrangement[]>([])
  const machine = useRef<DrumMachine | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState<string | null>(song.vocals[0]?.id ?? null)
  const [recordTarget, setRecordTarget] = useState('new')
  const [snap, setSnap] = useState(true)
  const [bar, setBar] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [step, setStep] = useState(-1)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('Build a beat, then record your first vocal layer.')
  const locked = !!game?.disabled || recording || starting
  const selectedClip = song.vocals.find(clip => clip.id === selected)
  const targetClip = song.vocals.find(clip => clip.id === recordTarget)
  const onSongChange = useRef(game?.onSongChange); onSongChange.current = game?.onSongChange

  useEffect(() => {
    const engine = new DrumMachine(songRef.current.pattern, setStep, setPlaying)
    engine.setSong(songRef.current)
    machine.current = engine
    const hide = () => { if (document.hidden) engine.stop() }
    document.addEventListener('visibilitychange', hide)
    return () => { engine.dispose(); machine.current = null; document.removeEventListener('visibilitychange', hide) }
  }, [])
  useEffect(() => {
    if (!active || game?.disabled) machine.current?.stop()
    else titleRef.current?.focus()
  }, [active, game?.disabled])
  useEffect(() => { if (!game?.disabled) onSongChange.current?.(song) }, [song, game?.disabled])

  async function play(next = songRef.current) {
    setStarting(true); setError('')
    try { await machine.current?.start(next) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to play the song.') }
    finally { setStarting(false) }
  }
  function apply(next: Arrangement, description: string, remember = true) {
    const old = songRef.current
    if (remember) history.current = [...history.current.slice(-19), old]
    const timingChanged = old.bpm !== next.bpm || old.vocals.length !== next.vocals.length || old.vocals.some((clip, index) => { const other = next.vocals[index]; return clip.id !== other.id || clip.bpm !== other.bpm || clip.startStep !== other.startStep || clip.trimStart !== other.trimStart || clip.trimEnd !== other.trimEnd || clip.voice.data !== other.voice.data })
    songRef.current = next; setSong(next); setMessage(description)
    machine.current?.setSong(next)
    if (playing && timingChanged && !recording) void play(next)
  }
  function undo() { const old = history.current.pop(); if (old) apply(old, 'Last edit undone.', false) }
  function editClip(id: string, patch: Partial<VocalClip>) {
    apply({ ...songRef.current, vocals: songRef.current.vocals.map(clip => clip.id === id ? { ...clip, ...patch } : clip) }, 'Vocal layer updated.')
  }
  function recordTake(voice: VoiceTrack) {
    const current = songRef.current
    const replacement = current.vocals.find(clip => clip.id === recordTarget)
    const id = replacement?.id ?? crypto.randomUUID()
    const clip = replacement ? { ...replacement, voice, bpm: voice.bpm, trimStart: undefined, trimEnd: undefined } : { id, name: `Voice ${current.vocals.length + 1}`, voice, bpm: voice.bpm, startStep: 0, volume: 1 }
    apply({ ...current, vocals: replacement ? current.vocals.map(item => item.id === id ? clip : item) : [...current.vocals, clip] }, 'Take added. Select its lane to shape the sample.')
    setSelected(id)
  }
  async function preview(id: Instrument) {
    try { await machine.current?.preview(id) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to preview.') }
  }
  const playingBar = step < 0 ? -1 : Math.floor(step / STEPS_PER_BAR)
  const notes = instruments.reduce((count, { id }) => count + song.pattern[id].filter(Boolean).length, 0)
  const barIsEmpty = instruments.every(({ id }) => !song.pattern[id].slice(bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).some(Boolean))

  return <main className="app studio-app">
    <header className="brand-row"><a className="brand" href="#home">beat<span>telephone</span><span className="brand-dot">.</span></a>{game ? <span className="badge">Song round</span> : <a className="secondary-button" href="#home">← Back to {hasLobby ? 'lobby' : 'home'}</a>}</header>
    {game?.toolbar}
    <section className="studio-brief" aria-labelledby={titleId}><div><p className="eyebrow">The studio</p><h1 ref={titleRef} id={titleId} tabIndex={-1}>Make it sound like you.</h1></div><p className="studio-prompt">“{game?.prompt ?? 'A raccoon breaking into a nightclub'}”</p></section>
    <div className="studio-transport">
      <button className={`play-button ${playing ? 'is-playing' : ''}`} disabled={!!game?.disabled || recording || starting} onClick={() => playing ? machine.current?.stop() : void play()}>{starting ? 'Starting…' : playing ? '■ Stop' : '▶ Play song'}</button>
      <fieldset disabled={locked} className="transport-tempo"><NumberControl label="Beat BPM" value={song.bpm} min={MIN_BPM} max={MAX_BPM} onChange={bpm => apply({ ...songRef.current, bpm }, 'Beat tempo updated. Vocal BPMs stay independent.')} /><span>4 bars · {Number((TOTAL_STEPS * stepSeconds(song.bpm)).toFixed(1))}s</span></fieldset>
      <VoiceRecorder bpm={song.bpm} targetName={targetClip?.name} disabled={!!game?.disabled || !active || starting || (!targetClip && song.vocals.length >= MAX_VOCAL_LAYERS)} onBusy={setRecording} onTake={recordTake} prepareBeat={async () => { await machine.current?.prepare() }} startBeat={async () => machine.current?.start(songRef.current)} stopBeat={() => machine.current?.stop()} />
      <label className="record-destination">Record into<select value={targetClip ? recordTarget : 'new'} disabled={locked} onChange={event => setRecordTarget(event.target.value)}><option value="new">New vocal layer</option>{song.vocals.map(clip => <option value={clip.id} key={clip.id}>Replace {clip.name}</option>)}</select></label>
      {game && <div className="transport-submit"><button className="secondary-button" disabled={locked || !song.vocals.length} onClick={() => game.onSubmit(songRef.current)}>Submit song</button><span role="status">{game.saveStatus}</span></div>}
    </div>
    <div className="studio-workspace">
      <div className="arrangement-main">
        <fieldset className="studio-controls" disabled={locked}>
          <section className="arrangement-panel" aria-label="Song timeline">
            <div className="panel-title"><h2>Arrangement</h2><button className="snap-toggle" aria-pressed={snap} onClick={() => setSnap(!snap)}>Snap {snap ? 'on' : 'off'}</button><span>{song.vocals.length} / {MAX_VOCAL_LAYERS} vocal layers</span></div>
            <div className="timeline-scroll"><div className="timeline">
              <div className="timeline-ruler"><span>4-bar loop</span><div>{Array.from({ length: 16 }, (_, i) => <span key={i}>{i % 4 === 0 ? `Bar ${i / 4 + 1}` : '·'}</span>)}</div></div>
              <div className="timeline-lane beat-lane"><span>Drums</span><div className="beat-overview">{Array.from({ length: TOTAL_STEPS }, (_, i) => <i key={i} className={`${instruments.some(({ id }) => song.pattern[id][i]) ? 'has-hit' : ''} ${step === i ? 'at-playhead' : ''}`} />)}</div></div>
              {song.vocals.map((clip, index) => <VocalLane key={clip.id} clip={clip} index={index} beatBpm={song.bpm} selected={selected === clip.id} step={step} onSelect={() => setSelected(clip.id)} disabled={locked} snap={snap} onEdit={patch => editClip(clip.id, patch)} />)}
              {!song.vocals.length && <div className="timeline-empty">Press <strong>Record voice</strong> above to add a sample. Layer harmonies, ad-libs, or a pitched-up hook.</div>}
            </div></div>
            <p className="panel-hint">Drag a clip to move it. Drag either edge to trim. Hold Shift for fine placement. Arrow keys nudge; Escape cancels a drag.</p>
          </section>
          <section className="editor" aria-label="Drum editor"><div className="panel-title"><h2>Drum sequencer</h2><span>Tap squares to make a beat</span></div>
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
                        const on = song.pattern[id][absoluteStep]
                        return <button key={localStep}
                          className={`step ${on ? 'active' : ''} ${step === absoluteStep ? 'current' : ''}`}
                          aria-label={`${name}, bar ${bar + 1}, beat ${beat + 1}, step ${subdivision + 1}`}
                          aria-pressed={on}
                          onClick={() => apply({ ...songRef.current, pattern: toggleStep(songRef.current.pattern, id, absoluteStep) }, `${name}: bar ${bar + 1}, step ${localStep + 1} ${on ? 'removed' : 'added'}.`)}
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
            <button onClick={undo} disabled={history.current.length === 0}>Undo edit</button>
            <button onClick={() => apply({ ...songRef.current, pattern: clearBar(songRef.current.pattern, bar) }, `Bar ${bar + 1} cleared. Undo brings it back.`)} disabled={barIsEmpty}>Clear bar</button>
            <button onClick={() => apply({ ...songRef.current, pattern: emptyPattern() }, 'Beat cleared. Start fresh, or undo to bring it back.')} disabled={notes === 0}>Clear all</button>
          </div>
        </div>

          </section>
          <section className="studio-presets"><span>Starting grooves</span>{presets.map(({ id, label }) => <button className="secondary-button" key={id} onClick={() => apply({ ...songRef.current, pattern: createPreset(id) }, `${label} loaded. Your vocal layers and mix are kept.`)}>{label}</button>)}</section>
        </fieldset>
      </div>
      <aside className="studio-sidebar">
        <fieldset disabled={locked} className="mixer-panel"><div className="panel-title"><h2>Song mix</h2><span>Saved with your song</span></div>
          <Level label="Beat volume" value={song.mix.beat} onChange={beat => apply({ ...songRef.current, mix: { ...songRef.current.mix, beat } }, 'Beat volume saved in your mix.')} />
          <Level label="Voice volume" value={song.mix.voice} onChange={voice => apply({ ...songRef.current, mix: { ...songRef.current.mix, voice } }, 'Voice volume saved in your mix.')} />
          <p className="panel-hint">Everyone hears these levels in the results.</p>
        </fieldset>
        <fieldset disabled={locked} className="clip-inspector"><div className="panel-title"><h2>Vocal sample</h2></div>
          {selectedClip ? <>
            <label className="sample-name">Name<input aria-label="Vocal layer name" value={selectedClip.name} maxLength={32} onChange={event => editClip(selectedClip.id, { name: event.target.value || 'Voice' })} /></label>
            <NumberControl label="Sample BPM" value={selectedClip.bpm} min={MIN_SAMPLE_BPM} max={MAX_SAMPLE_BPM} onChange={bpm => editClip(selectedClip.id, { bpm })} />
            <p className="sample-rate">Recorded at {selectedClip.voice.bpm} BPM · {(selectedClip.bpm / selectedClip.voice.bpm).toFixed(2)}× speed</p>
            <div className="sample-shortcuts"><button onClick={() => editClip(selectedClip.id, { bpm: Math.min(MAX_SAMPLE_BPM, selectedClip.voice.bpm * 2) })}>2× chipmunk</button><button onClick={() => editClip(selectedClip.id, { bpm: selectedClip.voice.bpm })}>Original</button></div>
            <Level label="Layer volume" value={selectedClip.volume} onChange={volume => editClip(selectedClip.id, { volume })} />
            <label className="position-control">Start position <span>Bar {Math.floor(selectedClip.startStep / 16) + 1}, step {Number((selectedClip.startStep % 16 + 1).toFixed(2))}</span><input type="range" aria-label="Vocal start position" min="0" max="63" value={selectedClip.startStep} onChange={event => editClip(selectedClip.id, { startStep: Number(event.target.value) })} /></label>
            <button className="text-button" onClick={() => editClip(selectedClip.id, { trimStart: undefined, trimEnd: undefined })}>Reset trim</button>
            <p className="panel-hint">Sample BPM changes speed and pitch without changing the drums. Timing edits restart playback from bar 1.</p>
            <button className="text-button" onClick={() => { apply({ ...songRef.current, vocals: songRef.current.vocals.filter(clip => clip.id !== selectedClip.id) }, 'Vocal layer removed. Undo brings it back.'); setSelected(null); if (recordTarget === selectedClip.id) setRecordTarget('new') }}>Remove layer</button>
          </> : <p className="panel-hint">Select a vocal lane in the timeline to adjust its sound and position.</p>}
        </fieldset>
      </aside>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    <footer className="page-footer"><p role="status">{message}</p><p>{game ? 'Recordings are shared with the room in results.' : 'Sandbox · Edits reset on refresh'}</p></footer>
  </main>
}

function NumberControl({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return <label className="number-control">{label}<input aria-label={label} type="number" min={min} max={max} step="1" value={draft} onChange={event => { setDraft(event.target.value); const next = event.target.valueAsNumber; if (Number.isInteger(next) && next >= min && next <= max && next !== value) onChange(next) }} onBlur={() => { const parsed = draft.trim() ? Number(draft) : value; const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value; setDraft(String(next)); if (next !== value) onChange(next) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}
function Level({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="mix-level"><span>{label}<output>{Math.round(value * 100)}%</output></span><input aria-label={label} type="range" min="0" max="100" value={Math.round(value * 100)} onChange={event => onChange(Number(event.target.value) / 100)} /></label>
}
