import Brand from './Brand'
import PianoEditor from './music/PianoEditor'
import { emptyPiano } from './music/piano'
import type { PianoTrack } from './music/piano'
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

type Arrangement = Song & { piano: PianoTrack; mix: Mix; vocals: VocalClip[] }
type GameStudio = {
  initialSong: Song; prompt: string | null; disabled: boolean; toolbar: ReactNode; saveStatus: string
  onSongChange: (song: Song) => void; onSubmit: (song: Song) => void
}
const presets: { id: Preset; label: string }[] = [
  { id: 'soul', label: 'Soul Chop' }, { id: 'stadium', label: 'Stadium Glow' }, { id: 'industrial', label: 'Industrial Stomp' },
]

export default function Studio({ active, hasLobby, game, onHome }: { onHome: () => void; active: boolean; hasLobby: boolean; game?: GameStudio }) {
  const titleId = useId()
  const [editableSong, setSong] = useState<Arrangement>(() => {
    const initial = game?.initialSong ?? { pattern: createPreset('soul'), bpm: DEFAULT_BPM }
    return { layers: initial.layers, piano: initial.piano ?? emptyPiano(), pattern: initial.pattern, bpm: initial.bpm, mix: initial.mix ?? { ...DEFAULT_MIX }, vocals: songVocals(initial) }
  })
  const backing = editableSong.layers ?? []
  const [sectionIndex, setSectionIndex] = useState(Math.max(0, backing.length - 1))
  const inspecting = sectionIndex < backing.length
  const earlier = backing[sectionIndex]
  const song: Arrangement = earlier ? { ...earlier, piano: earlier.piano ?? emptyPiano(), mix: earlier.mix ?? { ...DEFAULT_MIX }, vocals: songVocals(earlier) } : editableSong
  const songRef = useRef(editableSong)
  const playSection = useRef<number | undefined>(undefined)
  const history = useRef<Arrangement[]>([])
  const machine = useRef<DrumMachine | null>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState<string | null>(song.vocals[0]?.id ?? null)
  const [recordTarget, setRecordTarget] = useState('new')
  const [panel, setPanel] = useState<'piano' | 'drums' | 'vocals'>(() => song.piano.notes.length ? 'piano' : Object.values(song.pattern).some(track => track.some(Boolean)) ? 'drums' : song.vocals.length ? 'vocals' : 'piano')
  const [snap, setSnap] = useState(true)
  const [bar, setBar] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [songStep, setStep] = useState(-1)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('Add drums, piano, or vocals. Make this part your own.')
  const step = songStep >= 0 && Math.floor(songStep / TOTAL_STEPS) === sectionIndex ? songStep % TOTAL_STEPS : -1
  const busy = !!game?.disabled || recording || starting
  const locked = busy || inspecting
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
  useEffect(() => { if (!game?.disabled) onSongChange.current?.(editableSong) }, [editableSong, game?.disabled])

  async function play(next = songRef.current, section?: number) {
    setStarting(true); setError(''); playSection.current = section
    try { await machine.current?.start(next, section) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to play the song.') }
    finally { setStarting(false) }
  }
  function apply(next: Arrangement, description: string, remember = true) {
    if (inspecting) return
    const old = songRef.current
    if (remember) history.current = [...history.current.slice(-19), old]
    const timingChanged = old.bpm !== next.bpm || old.vocals.length !== next.vocals.length || old.vocals.some((clip, index) => { const other = next.vocals[index]; return clip.id !== other.id || clip.bpm !== other.bpm || clip.startStep !== other.startStep || clip.trimStart !== other.trimStart || clip.trimEnd !== other.trimEnd || clip.voice.data !== other.voice.data })
    songRef.current = next; setSong(next); setMessage(description)
    machine.current?.setSong(next)
    if (playing && timingChanged && !recording) void play(next, playSection.current)
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
    setSelected(id); setPanel('vocals')
  }
  async function preview(id: Instrument) {
    try { await machine.current?.preview(id) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to preview.') }
  }
  const playingBar = step < 0 ? -1 : Math.floor(step / STEPS_PER_BAR)
  const notes = instruments.reduce((count, { id }) => count + song.pattern[id].filter(Boolean).length, 0)
  const barIsEmpty = instruments.every(({ id }) => !song.pattern[id].slice(bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).some(Boolean))

  return <main className="app studio-app">
    <header className="brand-row"><Brand onHome={onHome} />{game ? <span className="badge">Song round</span> : <a className="secondary-button" href="#home">← Back to {hasLobby ? 'lobby' : 'home'}</a>}</header>
    {game?.toolbar}
    {game ? <section className="game-studio-prompt" aria-labelledby={titleId}>
      <p className="eyebrow">{game.prompt ? 'Your prompt · First music turn' : 'Follow the music'}</p>
      <h1 ref={titleRef} id={titleId} tabIndex={-1}>{game.prompt ?? 'Listen. Imagine. Add your part.'}</h1>
      {backing.length > 0 && <p>Listen to the song so far, then write what happens next. Select an earlier section to see its notes and recordings. The original prompt stays hidden.</p>}
    </section> : <h1 ref={titleRef} id={titleId} className="sr-only" tabIndex={-1}>Sandbox studio</h1>}
    {game && <section className="song-sections" aria-label="Song sections">
      <div className="section-heading"><strong>Song timeline</strong><span>{((backing.length + 1) * TOTAL_STEPS * stepSeconds(song.bpm)).toFixed(1)}s total · Sections play in order</span></div>
      <div className="section-list" role="group" aria-label="Choose a section to inspect or edit">
        {[...backing, editableSong].map((part, index) => <button key={index} disabled={recording || starting} aria-pressed={sectionIndex === index} className={`section-card ${songStep >= 0 && Math.floor(songStep / TOTAL_STEPS) === index ? 'sounding' : ''}`} onClick={() => { setSectionIndex(index); setSelected(songVocals(part)[0]?.id ?? null); setBar(0) }}>
          <strong>{index === backing.length ? 'Your section' : `Section ${index + 1}`}</strong>
          <span>{(index * TOTAL_STEPS * stepSeconds(song.bpm)).toFixed(1)}–{((index + 1) * TOTAL_STEPS * stepSeconds(song.bpm)).toFixed(1)}s · {index === backing.length ? 'Editable' : 'Read only'}</span>
          <div className="section-mini" aria-hidden="true">{Array.from({ length: 16 }, (_, beat) => <i key={beat} className={instruments.some(({ id }) => part.pattern[id].slice(beat * 4, beat * 4 + 4).some(Boolean)) || part.piano?.notes.some(n => Math.floor(n.start / 4) === beat) ? 'filled' : ''} />)}</div>
          <small>{part.piano?.notes.length ?? 0} piano notes · {songVocals(part).length} vocal clips</small>
        </button>)}
      </div>
      <p role="status">{inspecting ? `Viewing section ${sectionIndex + 1}. Its notes and recordings are preserved. Select Your section to continue writing.` : 'Editing your section. It plays after the earlier sections.'}</p>
    </section>}
    <div className="studio-transport">
      <button className={`play-button ${playing ? 'is-playing' : ''}`} disabled={!!game?.disabled || recording || starting} onClick={() => playing ? machine.current?.stop() : void play()}>{starting ? 'Starting…' : playing ? '■ Stop' : '▶ Play song'}</button>
      {game && <button className="secondary-button" disabled={busy} onClick={() => void play(songRef.current, sectionIndex)}>▶ Preview section {sectionIndex + 1}</button>}
      <fieldset disabled={locked || backing.length > 0} className="transport-tempo"><NumberControl label="Beat BPM" value={song.bpm} min={MIN_BPM} max={MAX_BPM} onChange={bpm => apply({ ...songRef.current, bpm }, 'Beat tempo updated. Vocal BPMs stay independent.')} /><span>4 bars · {Number((TOTAL_STEPS * stepSeconds(song.bpm)).toFixed(1))}s</span></fieldset>
      <VoiceRecorder bpm={song.bpm} targetName={targetClip?.name} disabled={inspecting || !!game?.disabled || !active || starting || (!targetClip && song.vocals.length >= MAX_VOCAL_LAYERS)} onBusy={setRecording} onTake={recordTake} prepareBeat={async () => { await machine.current?.prepare() }} startBeat={async () => { playSection.current = backing.length; return machine.current?.start(songRef.current, backing.length) }} stopBeat={() => machine.current?.stop()} />
      <label className="record-destination">Record into<select value={targetClip ? recordTarget : 'new'} disabled={locked} onChange={event => setRecordTarget(event.target.value)}><option value="new">New vocal layer</option>{song.vocals.map(clip => <option value={clip.id} key={clip.id}>Replace {clip.name}</option>)}</select></label>
      {game && <div className="transport-submit"><button className="secondary-button" disabled={busy} onClick={() => game.onSubmit(songRef.current)}>Submit part</button><span role="status">{game.saveStatus}</span></div>}
    </div>
    <div className="studio-tabs" role="group" aria-label="Choose instrument editor">
      {(['piano', 'drums', 'vocals'] as const).map(tab => <button key={tab} aria-pressed={panel === tab} onClick={() => setPanel(tab)}>{tab === 'piano' ? '♫ Piano' : tab === 'drums' ? '▦ Drums' : '● Vocals'}<small>{tab === 'piano' ? `${song.piano.notes.length} notes` : tab === 'drums' ? `${notes} hits` : `${song.vocals.length} layers`}</small></button>)}
      <button className="studio-undo" onClick={undo} disabled={locked || history.current.length === 0}>Undo edit</button>
    </div>
    <div className={`studio-workspace panel-${panel}`}>
      <div className="arrangement-main">
        <fieldset className="studio-controls" disabled={busy}>
          {panel === 'piano' && <PianoEditor track={song.piano} disabled={locked} step={step} onChange={(piano, message) => apply({ ...songRef.current, piano }, message)} onPreview={degree => { void machine.current?.previewPiano(degree).catch(cause => setError(cause instanceof Error ? cause.message : 'Unable to preview piano.')) }} />}
          <section hidden={panel !== 'vocals'} className="arrangement-panel" aria-label="Song timeline">
            <div className="panel-title"><h2>Arrangement</h2><button className="snap-toggle" aria-pressed={snap} onClick={() => setSnap(!snap)}>Snap {snap ? 'on' : 'off'}</button><span>{song.vocals.length} / {MAX_VOCAL_LAYERS} vocal layers</span></div>
            <div className="timeline-scroll"><div className="timeline">
              <div className="timeline-ruler"><span>4-bar loop</span><div>{Array.from({ length: 16 }, (_, i) => <span key={i}>{i % 4 === 0 ? `Bar ${i / 4 + 1}` : '·'}</span>)}</div></div>
              <div className="timeline-lane beat-lane"><span>Drums</span><div className="beat-overview">{Array.from({ length: TOTAL_STEPS }, (_, i) => <i key={i} className={`${instruments.some(({ id }) => song.pattern[id][i]) ? 'has-hit' : ''} ${step === i ? 'at-playhead' : ''}`} />)}</div></div>
              {song.vocals.map((clip, index) => <VocalLane key={clip.id} clip={clip} index={index} beatBpm={song.bpm} selected={selected === clip.id} step={step} onSelect={() => setSelected(clip.id)} disabled={locked} selectable={inspecting} snap={snap} onEdit={patch => editClip(clip.id, patch)} />)}
              {!song.vocals.length && <div className="timeline-empty">{inspecting ? "No vocal clips in this section." : <>Press <strong>Record voice</strong> above to add a sample. Layer harmonies, ad-libs, or a pitched-up hook.</>}</div>}
            </div></div>
            <p className="panel-hint">Drag a clip to move it. Drag either edge to trim. Hold Shift for fine placement. Arrow keys nudge; Escape cancels a drag.</p>
          </section>
          <section hidden={panel !== 'drums'} className="editor" aria-label="Drum editor"><div className="panel-title"><h2>Drum sequencer</h2><span>Tap squares to make a beat</span></div>
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
                        return <button key={localStep} disabled={locked}
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
            <button onClick={() => apply({ ...songRef.current, pattern: clearBar(songRef.current.pattern, bar) }, `Bar ${bar + 1} cleared. Undo brings it back.`)} disabled={locked || barIsEmpty}>Clear bar</button>
            <button onClick={() => apply({ ...songRef.current, pattern: emptyPattern() }, 'Beat cleared. Start fresh, or undo to bring it back.')} disabled={locked || notes === 0}>Clear all</button>
          </div>
        </div>

          </section>
          <section hidden={panel !== 'drums'} className="studio-presets"><span>Starting grooves</span>{presets.map(({ id, label }) => <button className="secondary-button" disabled={locked} key={id} onClick={() => apply({ ...songRef.current, pattern: createPreset(id) }, `${label} loaded. Your vocal layers and mix are kept.`)}>{label}</button>)}</section>
        </fieldset>
      </div>
      <aside className="studio-sidebar">
        <fieldset disabled={locked} className="mixer-panel"><div className="panel-title"><h2>{game ? "Your part’s mix" : "Song mix"}</h2><span>Saved with your song</span></div>
          <Level label="Beat volume" value={song.mix.beat} onChange={beat => apply({ ...songRef.current, mix: { ...songRef.current.mix, beat } }, 'Beat volume saved in your mix.')} />
          <Level label="Piano volume" value={song.piano.volume} onChange={volume => apply({ ...songRef.current, piano: { ...songRef.current.piano, volume } }, 'Piano volume saved.')} />
          <Level label="Voice volume" value={song.mix.voice} onChange={voice => apply({ ...songRef.current, mix: { ...songRef.current.mix, voice } }, 'Voice volume saved in your mix.')} />
          <p className="panel-hint">These levels are saved for this section.</p>
        </fieldset>
        <fieldset hidden={panel !== 'vocals'} disabled={locked} className="clip-inspector"><div className="panel-title"><h2>Vocal sample</h2></div>
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
    <footer className="page-footer"><p role="status">{message}</p><p>{game ? 'Earlier sections are preserved · Your section extends the song.' : 'Sandbox · Edits reset on refresh'}</p></footer>
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
