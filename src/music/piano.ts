export type PianoNote = { id: string; degree: number; start: number; length: number; velocity: number }
export type PianoTrack = { root: number; mode: 'major' | 'minor'; notes: PianoNote[]; volume: number; warmth: number; swing: number }
export const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
export const emptyPiano = (): PianoTrack => ({ root: 0, mode: 'major', notes: [], volume: 0.65, warmth: 0.6, swing: 0 })
export function noteMidi(track: PianoTrack, degree: number) { return 60 + track.root + (track.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11, 12] : [0, 2, 3, 5, 7, 8, 10, 12])[degree] }
export function noteLabel(track: PianoTrack, degree: number) { const midi = noteMidi(track, degree); return `${KEY_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}` }
export function validatePiano(value: unknown): PianoTrack {
  if (!value || typeof value !== 'object') throw new Error('Invalid piano track.')
  const track = value as PianoTrack
  const unit = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1
  if (!Number.isInteger(track.root) || track.root < 0 || track.root > 11 || !['major', 'minor'].includes(track.mode) || !unit(track.volume) || !unit(track.warmth) || !unit(track.swing) || track.swing > 0.45 || !Array.isArray(track.notes) || track.notes.length > 512) throw new Error('Invalid piano settings.')
  const ids = new Set<string>()
  const notes = track.notes.map(note => {
    if (!note || typeof note.id !== 'string' || !note.id || note.id.length > 64 || ids.has(note.id) || !Number.isInteger(note.degree) || note.degree < 0 || note.degree > 7 || !Number.isInteger(note.start) || note.start < 0 || note.start > 63 || !Number.isInteger(note.length) || note.length < 1 || note.length > 16 - note.start % 16 || !unit(note.velocity) || note.velocity < 0.1) throw new Error('Invalid piano note.')
    ids.add(note.id)
    return { id: note.id, degree: note.degree, start: note.start, length: note.length, velocity: note.velocity }
  })
  return { root: track.root, mode: track.mode, volume: track.volume, warmth: track.warmth, swing: track.swing, notes }
}
export function editPianoNote(note: PianoNote, mode: 'move' | 'resize', steps: number, degrees = 0): PianoNote {
  const bar = Math.floor(note.start / 16) * 16
  if (mode === 'resize') return { ...note, length: Math.max(1, Math.min(16 - note.start % 16, note.length + steps)) }
  return { ...note, start: Math.max(bar, Math.min(bar + 16 - note.length, note.start + steps)), degree: Math.max(0, Math.min(7, note.degree + degrees)) }
}
export function stampChord(track: PianoTrack, degree: number, start: number, velocity: number, id: () => string): PianoTrack {
  const degrees = [degree, (degree + 2) % 7, (degree + 4) % 7]
  return { ...track, notes: [...track.notes.filter(n => !(n.start === start && degrees.includes(n.degree))), ...degrees.map(d => ({ id: id(), degree: d, start, length: Math.min(4, 16 - start % 16), velocity }))] }
}
export function repeatPianoBar(track: PianoTrack, bar: number, id: () => string): PianoTrack {
  const phrase = track.notes.filter(n => Math.floor(n.start / 16) === bar)
  return { ...track, notes: Array.from({ length: 4 }, (_, b) => phrase.map(n => ({ ...n, id: id(), start: b * 16 + n.start % 16 }))).flat() }
}
// An original two-string piano voice, with a hammer transient and damped partials.
export function synthesizePiano(midi: number, rate: number, gate: number, warmth: number): Float32Array {
  const samples = new Float32Array(Math.ceil((gate + 0.12) * rate))
  const hz = 440 * 2 ** ((midi - 69) / 12)
  let seed = midi + 1, low = 0
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate
    let sound = 0
    for (let partial = 1; partial <= 7; partial++) {
      const frequency = hz * partial * Math.sqrt(1 + 0.00012 * partial * partial)
      if (frequency > rate * 0.43) break
      const phase = 2 * Math.PI * frequency * t
      const amplitude = Math.exp(-t * (1.3 + partial * 0.65)) / partial ** (1.25 + warmth * 1.1)
      sound += (Math.sin(phase) + Math.sin(phase * 1.0014) * 0.45) * amplitude
    }
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    low += 0.25 * ((seed / 2147483648 - 1) - low)
    sound += low * Math.exp(-t * 150) * (0.1 - warmth * 0.06)
    const attack = Math.min(1, t / 0.003)
    const release = t <= gate ? 1 : Math.max(0, 1 - (t - gate) / 0.12) ** 2
    samples[i] = Math.tanh(sound * 0.6) * attack * release * 0.55 * Math.min(1, (samples.length - 1 - i) / (rate * 0.005))
  }
  return samples
}
