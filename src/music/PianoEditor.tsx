import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { editPianoNote, KEY_NAMES, noteLabel, repeatPianoBar, stampChord } from './piano'
import type { PianoNote, PianoTrack } from './piano'

type Props = { track: PianoTrack; disabled: boolean; step: number; onChange: (track: PianoTrack, message: string) => void; onPreview: (degree: number) => void }
export default function PianoEditor({ track, disabled, step, onChange, onPreview }: Props) {
  const [bar, setBar] = useState(0)
  const [beat, setBeat] = useState(0)
  const [strength, setStrength] = useState(0.8)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<PianoNote | null>(null)
  const [cursor, setCursor] = useState(0)
  const cells = useRef<(HTMLButtonElement | null)[]>([])
  const grid = useRef<HTMLDivElement>(null)
  const drag = useRef<{ original: PianoNote; next: PianoNote; mode: 'move' | 'resize'; x: number; y: number; width: number; height: number; pointer: number } | null>(null)
  const cancel = () => { drag.current = null; setDraft(null) }
  useEffect(cancel, [disabled, track, bar])
  const notes = track.notes.filter(n => Math.floor(n.start / 16) === bar)
  const chosen = track.notes.find(n => n.id === selected)
  const change = (next: PianoTrack, message: string) => { if (!disabled && next.notes.length <= 512) onChange(next, message) }
  const edit = (note: PianoNote) => change({ ...track, notes: track.notes.map(n => n.id === note.id ? note : n) }, 'Piano note updated.')
  function add(degree: number, column: number) {
    const start = bar * 16 + column
    const existing = notes.find(n => n.degree === degree && start >= n.start && start < n.start + n.length)
    if (existing) { setSelected(existing.id); onPreview(degree); return }
    const note = { id: crypto.randomUUID(), degree, start, length: Math.min(2, 16 - column), velocity: strength }
    change({ ...track, notes: [...track.notes, note] }, 'Piano note added. Drag to move; pull its right edge to lengthen.')
    setSelected(note.id); onPreview(degree)
  }
  function begin(event: PointerEvent<HTMLButtonElement>, note: PianoNote, mode: 'move' | 'resize') {
    if (disabled || event.button !== 0) return
    event.preventDefault(); event.currentTarget.focus(); setSelected(note.id)
    const box = grid.current!.getBoundingClientRect()
    drag.current = { original: note, next: note, mode, x: event.clientX, y: event.clientY, width: box.width, height: box.height, pointer: event.pointerId }
    setDraft(note); event.currentTarget.setPointerCapture(event.pointerId)
  }
  const handlers = (note: PianoNote, mode: 'move' | 'resize') => ({
    disabled,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => begin(event, note, mode),
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const current = drag.current
      if (!current || current.pointer !== event.pointerId || disabled) return
      current.next = editPianoNote(current.original, current.mode, Math.round((event.clientX - current.x) / current.width * 16), -Math.round((event.clientY - current.y) / current.height * 8))
      setDraft(current.next)
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const current = drag.current
      if (current && current.pointer === event.pointerId && !disabled && (current.next.start !== note.start || current.next.degree !== note.degree || current.next.length !== note.length)) edit(current.next)
      cancel()
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel: cancel, onLostPointerCapture: cancel,
    onClick: () => setSelected(note.id),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape') { cancel(); return }
      if (disabled || drag.current) return
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); change({ ...track, notes: track.notes.filter(n => n.id !== note.id) }, 'Piano note removed.'); return }
      if (!event.key.startsWith('Arrow')) return
      event.preventDefault()
      edit(editPianoNote(note, event.shiftKey ? 'resize' : mode, event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0, event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0))
    },
  })
  return <section className="piano-editor" aria-label="Piano editor">
    <div className="piano-toolbar">
      <label>Key<select disabled={disabled} value={track.root} onChange={e => change({ ...track, root: Number(e.target.value) }, 'Piano transposed. All notes stay in key.')}>{KEY_NAMES.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
      <label>Mood<select disabled={disabled} value={track.mode} onChange={e => change({ ...track, mode: e.target.value as PianoTrack['mode'] }, 'Piano scale updated.')}><option value="major">Major · bright</option><option value="minor">Minor · mellow</option></select></label>
      <div className="piano-bars" role="group" aria-label="Piano bar">{[0, 1, 2, 3].map(b => <button key={b} aria-pressed={bar === b} onClick={() => { setBar(b); setSelected(null) }} className={Math.floor(step / 16) === b ? 'sounding' : ''}>Bar {b + 1}</button>)}</div>
    </div>
    <div className="chord-stamps"><span>Stamp a chord</span>{[0, 3, 4, 5].map((degree, i) => <button disabled={disabled} key={degree} onClick={() => change(stampChord(track, degree, bar * 16 + beat * 4, strength, () => crypto.randomUUID()), 'Chord added at the chosen beat.')}>{['Home', 'Lift', 'Push', 'Dream'][i]}</button>)}<label>at beat<select aria-label="Chord beat" value={beat} disabled={disabled} onChange={e => setBeat(Number(e.target.value))}>{[0, 1, 2, 3].map(b => <option key={b} value={b}>{b + 1}</option>)}</select></label></div>
    <div className="piano-scroll"><div className="piano-roll">
      <div className="piano-ruler"><span>In key ♫</span><div>{Array.from({ length: 16 }, (_, i) => <span key={i}>{i % 4 === 0 ? i / 4 + 1 : '·'}</span>)}</div></div>
      <div className="piano-body"><div className="piano-keys">{Array.from({ length: 8 }, (_, row) => <button disabled={disabled} key={row} onClick={() => onPreview(7 - row)} aria-label={`Preview ${noteLabel(track, 7 - row)}`}>{noteLabel(track, 7 - row)}</button>)}</div>
      <div className="piano-grid" ref={grid} aria-label={`Bar ${bar + 1} piano notes`}>
        {Array.from({ length: 128 }, (_, index) => {
          const row = Math.floor(index / 16), column = index % 16
          return <button key={index} ref={el => { cells.current[index] = el }} disabled={disabled} tabIndex={cursor === index ? 0 : -1} className={`piano-cell ${column % 4 === 0 ? 'beat-line' : ''}`} aria-label={`Add ${noteLabel(track, 7 - row)}, bar ${bar + 1}, step ${column + 1}`} onFocus={() => setCursor(index)} onClick={() => add(7 - row, column)} onKeyDown={event => {
            const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -16 : event.key === 'ArrowDown' ? 16 : 0
            if (delta) { event.preventDefault(); const next = Math.max(0, Math.min(127, index + delta)); setCursor(next); cells.current[next]?.focus() }
          }} />
        })}
        {notes.map(original => { const note = draft?.id === original.id ? draft : original; return <div key={note.id} className={`piano-note ${selected === note.id ? 'selected' : ''}`} style={{ left: `${note.start % 16 / 16 * 100}%`, top: `${(7 - note.degree) / 8 * 100}%`, width: `${note.length / 16 * 100}%` }}>
          <button {...handlers(original, 'move')} className="piano-note-body" aria-label={`${noteLabel(track, note.degree)}, step ${note.start % 16 + 1}, length ${note.length}`} title="Drag to move · Arrows to move · Shift+arrows to resize · Delete to remove">{noteLabel(track, note.degree)}</button>
          <button {...handlers(original, 'resize')} className="piano-note-edge" aria-label={`Resize ${noteLabel(track, note.degree)} at step ${note.start % 16 + 1}`} title="Drag to change length">│</button>
        </div> })}
        {Math.floor(step / 16) === bar && <span className="piano-playhead" style={{ left: `${step % 16 / 16 * 100}%` }} />}
      </div></div>
    </div></div>
    <div className="piano-note-tools">{chosen ? <>
      <span>{noteLabel(track, chosen.degree)} selected</span>
      <label>Length<input disabled={disabled} aria-label="Selected note length" type="number" min="1" max={16 - chosen.start % 16} value={chosen.length} onChange={e => { const length = e.target.valueAsNumber; if (Number.isInteger(length) && length >= 1 && length <= 16 - chosen.start % 16) edit({ ...chosen, length }) }} /></label>
      <label>Strength<input disabled={disabled} aria-label="Selected note strength" type="range" min="10" max="100" value={chosen.velocity * 100} onChange={e => edit({ ...chosen, velocity: Number(e.target.value) / 100 })} /></label>
      <button disabled={disabled} onClick={() => { change({ ...track, notes: track.notes.filter(n => n.id !== chosen.id) }, 'Piano note removed.'); setSelected(null) }}>Delete note</button>
    </> : <span>Click a square to add a note. Drag notes to move; pull their right edge to resize.</span>}</div>
    <div className="piano-feel">{([{ label: 'New note strength', value: strength, max: 100, set: (v: number) => setStrength(v) }, { label: 'Warmth', value: track.warmth, max: 100, set: (v: number) => change({ ...track, warmth: v }, 'Piano tone saved.') }, { label: 'Swing', value: track.swing, max: 45, set: (v: number) => change({ ...track, swing: v }, 'Piano swing saved.') }]).map(control => <label key={control.label}>{control.label}<input disabled={disabled} type="range" aria-label={control.label} min={control.label === 'New note strength' ? 10 : 0} max={control.max} value={control.value * 100} onChange={e => control.set(Number(e.target.value) / 100)} /></label>)}</div>
    <div className="piano-phrase-actions">
      <button disabled={disabled || !notes.length} onClick={() => change(repeatPianoBar(track, bar, () => crypto.randomUUID()), 'Current piano bar repeated across all four bars.')}>Repeat bar to all 4</button>
      <button disabled={disabled || !notes.length} onClick={() => { const last = [...notes].sort((a, b) => b.start - a.start)[0]; edit({ ...last, degree: (last.degree + 1) % 8 }) }}>Vary last note</button>
      <button disabled={disabled || !notes.length} onClick={() => change({ ...track, notes: track.notes.filter(n => Math.floor(n.start / 16) !== bar) }, 'Piano bar cleared. Undo brings it back.')}>Clear piano bar</button>
    </div>
  </section>
}
