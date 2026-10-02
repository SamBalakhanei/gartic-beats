import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyPiano, noteMidi, validatePiano, stampChord, repeatPianoBar, editPianoNote, synthesizePiano } from './piano.ts'
import { validateSong } from '../../server/game.ts'
import { emptyPattern } from './pattern.ts'
let serial = 0
const nextId = () => `note-${++serial}`

test('all piano keys expose an ascending major or minor scale spanning one octave', () => {
  for (let root = 0; root < 12; root++) for (const mode of ['major', 'minor']) {
    const track = { ...emptyPiano(), root, mode }
    const notes = Array.from({ length: 8 }, (_, degree) => noteMidi(track, degree))
    assert.deepEqual(notes.map(n => n - notes[0]), mode === 'major' ? [0,2,4,5,7,9,11,12] : [0,2,3,5,7,8,10,12])
    assert.equal(notes[0], 60 + root)
  }
})

test('chord stamps stay in key, replace matching starts, and preserve unrelated notes', () => {
  for (const degree of [0, 3, 4, 5]) {
    const original = stampChord(emptyPiano(), degree, 4, 0.8, nextId)
    const restamped = stampChord(original, degree, 4, 0.6, nextId)
    assert.equal(original.notes.length, 3)
    assert.equal(restamped.notes.length, 3)
    assert.ok(restamped.notes.every(n => n.velocity === 0.6 && n.start === 4 && n.length === 4))
    assert.deepEqual(validatePiano(restamped), restamped)
    const added = stampChord(original, degree, 12, 0.7, nextId)
    assert.equal(added.notes.length, 6)
    assert.deepEqual(added.notes.slice(0, 3), original.notes)
  }
})

test('repeat uses the chosen bar and gives every copy independent notes and IDs', () => {
  const original = stampChord(emptyPiano(), 4, 36, 0.8, nextId)
  const repeated = repeatPianoBar(original, 2, nextId)
  assert.equal(repeated.notes.length, 12)
  assert.equal(new Set(repeated.notes.map(n => n.id)).size, 12)
  assert.deepEqual(repeated.notes.map(n => n.start), [4,4,4,20,20,20,36,36,36,52,52,52])
  repeated.notes[0].length = 1
  assert.equal(repeated.notes[3].length, 4)
  assert.equal(original.notes[0].length, 4)
})

test('move and resize clamp to the selected bar and scale without mutating undo snapshots', () => {
  const note = { id: 'a', start: 20, degree: 4, length: 4, velocity: 0.8 }
  assert.deepEqual(editPianoNote(note, 'move', 100, 100), { ...note, start: 28, degree: 7 })
  assert.deepEqual(editPianoNote(note, 'move', -100, -100), { ...note, start: 16, degree: 0 })
  assert.equal(editPianoNote(note, 'resize', 100).length, 12)
  assert.equal(editPianoNote(note, 'resize', -100).length, 1)
  assert.deepEqual(note, { id: 'a', start: 20, degree: 4, length: 4, velocity: 0.8 })
})

test('song validation preserves piano mix and feel, copies notes, and accepts older songs', () => {
  const piano = { ...stampChord(emptyPiano(), 0, 0, 0.7, nextId), volume: 0.3, warmth: 0.8, swing: 0.2 }
  const song = { pattern: emptyPattern(), bpm: 100, piano }
  const saved = validateSong(song)
  assert.deepEqual(saved, song)
  piano.notes[0].length = 1
  assert.equal(saved.piano.notes[0].length, 4)
  const legacy = { pattern: emptyPattern(), bpm: 120 }
  assert.deepEqual(validateSong(legacy), legacy)
})

test('piano validation rejects invalid settings, duplicate IDs, excessive notes and out-of-bar lengths', () => {
  const piano = stampChord(emptyPiano(), 0, 0, 0.7, nextId)
  for (const patch of [{ volume: NaN }, { volume: -1 }, { warmth: 2 }, { swing: 0.5 }, { mode: 'unknown' }, { root: 12 }, { root: 0.5 }, { notes: Array(513).fill(piano.notes[0]) }]) assert.throws(() => validatePiano({ ...piano, ...patch }))
  for (const patch of [{ start: 64 }, { length: 17 }, { start: 15, length: 2 }, { degree: 8 }, { velocity: 0 }, { start: 0.5 }, { id: '' }]) assert.throws(() => validatePiano({ ...piano, notes: [{ ...piano.notes[0], ...patch }] }))
  assert.throws(() => validatePiano({ ...piano, notes: [piano.notes[0], piano.notes[0]] }))
  for (const value of [null, false, {}, { ...piano, notes: [null] }]) assert.throws(() => validatePiano(value))
})

test('piano tone is deterministic, audible, bounded and releases cleanly across sample rates', () => {
  for (const rate of [16000, 44100, 48000]) for (const midi of [60, 83]) for (const warmth of [0, 1]) {
    const sound = synthesizePiano(midi, rate, 0.2, warmth)
    let energy = 0
    for (const sample of sound) { assert.ok(Number.isFinite(sample) && Math.abs(sample) < 0.56); energy += sample * sample }
    assert.ok(energy > 1)
    assert.equal(Math.abs(sound[0]), 0)
    assert.equal(Math.abs(sound.at(-1)), 0)
    assert.deepEqual(sound, synthesizePiano(midi, rate, 0.2, warmth))
  }
})
