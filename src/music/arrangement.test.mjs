import test from 'node:test'
import assert from 'node:assert/strict'
import { clipTiming, editClipGesture } from './arrangement.ts'
import { DrumMachine } from './DrumMachine.ts'
import { emptyPattern } from './pattern.ts'
import { withVoice } from '../../server/test-voice.mjs'
import { validateSong } from '../../server/game.ts'

const voice = withVoice({ bpm: 120 }).voice
const lead = { id: 'lead', name: 'Lead', voice, bpm: 240, startStep: 0, volume: 0.7 }
const harmony = { ...lead, id: 'harmony', name: 'Harmony', bpm: 120, volume: 0.4 }
const song = { bpm: 120, pattern: emptyPattern(), mix: { beat: 0.3, voice: 0.9 }, vocals: [lead, harmony] }

test('sample speed is independent of beat tempo and tails trim at the loop boundary', () => {
  assert.equal(clipTiming(lead, 120).rate, 2)
  assert.equal(clipTiming(lead, 80).rate, 2)
  assert.equal(clipTiming(lead, 80).duration, 4)
  const late = clipTiming({ ...harmony, startStep: 48 }, 120)
  assert.equal(late.startSeconds, 6)
  assert.equal(late.audibleSeconds, 2)
  assert.equal(late.widthPercent, 25)
})

test('layered songs preserve all mix settings and reject malformed arrangements', () => {
  assert.deepEqual(validateSong(song), song)
  for (const patch of [{ mix: { beat: 2, voice: 1 } }, { mix: { beat: NaN, voice: 1 } }, { vocals: Array(5).fill(lead) }, { vocals: [lead, lead] }]) assert.throws(() => validateSong({ ...song, ...patch }))
  for (const patch of [{ bpm: 0 }, { bpm: 481 }, { volume: -1 }, { startStep: 64 }, { startStep: NaN }, { name: '' }]) assert.throws(() => validateSong({ ...song, vocals: [{ ...lead, ...patch }] }))
})

test('shared playback engine overlaps layers with saved pitch and independent gain buses', async t => {
  const contexts = []
  const engines = []
  t.after(() => engines.forEach(engine => engine.dispose()))
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value } })
  class Context {
    currentTime = 0; sampleRate = 16000; state = 'running'; destination = {}; sources = []; gains = []
    constructor() { contexts.push(this) }
    async resume() {} async close() {}
    createGain() { const node = { gain: param(), connect(to) { this.to = to }, disconnect() {} }; this.gains.push(node); return node }
    createDynamicsCompressor() { return { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), connect() {} } }
    createBuffer(_, size) { return { duration: size / this.sampleRate, getChannelData: () => new Float32Array(size) } }
    async decodeAudioData() { return { vocal: true } }
    createBufferSource() { const source = { playbackRate: param(), connect(to) { this.to = to }, disconnect() {}, start(at, offset = 0) { this.at = at; this.offset = offset }, stop(at) { this.end = at } }; this.sources.push(source); return source }
  }
  const globals = { window: { AudioContext: Context }, AudioContext: Context, document: { hidden: false }, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} }
  for (const [key, value] of Object.entries(globals)) { const old = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { configurable: true, value }); t.after(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]) }
  const snapshots = []
  for (let pass = 0; pass < 2; pass++) {
    const engine = new DrumMachine(song.pattern, () => {}, () => {})
    engines.push(engine)
    await engine.start(song)
    const context = contexts.at(-1)
    const sources = context.sources.filter(source => source.buffer.vocal)
    assert.equal(sources.length, 2)
    assert.equal(sources[0].at, sources[1].at)
    snapshots.push(sources.map(source => ({ rate: source.playbackRate.value, volume: source.to.gain.value, bus: source.to.to.gain.value, at: source.at, end: source.end })))
    assert.deepEqual(snapshots.at(-1).map(item => item.rate), [2, 1])
    assert.deepEqual(snapshots.at(-1).map(item => item.volume), [0.7, 0.4])
    assert.equal(context.gains[1].gain.value, 0.3)
    engine.setMix({ beat: 0.1, voice: 0.8 }, [{ ...lead, volume: 0.2 }, harmony])
    assert.equal(context.gains[1].gain.value, 0.1)
    assert.equal(sources[0].to.to.gain.value, 0.8)
    assert.equal(sources[0].to.gain.value, 0.2)
    engine.stop()
  }
  assert.deepEqual(snapshots[0], snapshots[1])
  const trimmedEngine = new DrumMachine(song.pattern, () => {}, () => {})
  engines.push(trimmedEngine)
  await trimmedEngine.start({ ...song, vocals: [{ ...lead, startStep: 0.5, trimStart: 0.5, trimEnd: 1.5 }] })
  const trimmedSource = contexts.at(-1).sources.find(source => source.buffer.vocal)
  assert.equal(trimmedSource.offset, 0.5)
  assert.ok(Math.abs(trimmedSource.at - 0.1025) < 1e-9)
  assert.ok(Math.abs(trimmedSource.end - trimmedSource.at - 0.5) < 1e-9)

  // Drive the scheduler explicitly; no browser, speakers or wall-clock wait.
  let tick
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 0 })
  const pianoSong = { ...song, bpm: 240, vocals: [], piano: { root: 0, mode: 'major', warmth: 0.5, swing: 0.3, volume: 0.4, notes: [
    { id: 'p', start: 0, degree: 0, length: 4, velocity: 0.8 },
    { id: 'q', start: 1, degree: 2, length: 2, velocity: 0.6 },
  ] } }
  const pianoSnapshots = []
  for (let pass = 0; pass < 2; pass++) {
    const pianoEngine = new DrumMachine(pianoSong.pattern, () => {}, () => {})
    engines.push(pianoEngine)
    await pianoEngine.start(pianoSong)
    const context = contexts.at(-1)
    assert.equal(context.sources.length, 1)
    const first = context.sources[0]
    assert.equal(first.at, 0.04)
    assert.equal(first.to.to.gain.value, 0.4)
    assert.ok(Math.abs(first.to.gain.value - 0.6) < 1e-9)
    assert.ok(first.end > first.at)
    context.currentTime = 0.02
    tick()
    assert.equal(context.sources.length, 2)
    const second = context.sources[1]
    assert.ok(Math.abs(second.at - (0.04 + 15 / 240 * 1.3)) < 1e-9)
    pianoSnapshots.push(context.sources.map(source => ({ at: source.at, end: source.end, gain: source.to.gain.value, volume: source.to.to.gain.value, duration: source.buffer.duration })))
    pianoEngine.setSong({ ...pianoSong, piano: { ...pianoSong.piano, volume: 0.2 } })
    assert.equal(first.to.to.gain.value, 0.2)
    pianoEngine.stop()
  }
  assert.deepEqual(pianoSnapshots[0], pianoSnapshots[1])

  // Earlier contributions play first, then the new section on the same clock.
  const chainEngine = new DrumMachine(song.pattern, () => {}, () => {})
  engines.push(chainEngine)
  const earlier = { ...song, piano: { ...pianoSong.piano, notes: [pianoSong.piano.notes[0]] } }
  const newest = { ...song, layers: [earlier], mix: { beat: .8, voice: .5 } }
  await chainEngine.start(newest)
  const chainContext = contexts.at(-1)
  const firstVocals = chainContext.sources.filter(source => source.buffer.vocal)
  assert.equal(firstVocals.length, 2, 'only the earlier section starts at the beginning')
  assert.ok(firstVocals.every(source => source.at === .04))
  assert.ok(Math.abs(firstVocals[0].to.gain.value - .7 * .9) < 1e-9)
  assert.equal(chainContext.sources.find(source => !source.buffer.vocal).at, .04)
  chainEngine.setMix({ beat: .1, voice: .1 }, [{ ...lead, volume: .1 }, harmony])
  assert.ok(Math.abs(firstVocals[0].to.gain.value - .7 * .9) < 1e-9)
  chainContext.currentTime = 7.95
  tick()
  const allVocals = chainContext.sources.filter(source => source.buffer.vocal)
  assert.equal(allVocals.length, 4)
  assert.ok(Math.abs(allVocals[2].at - 8.04) < 1e-9, 'new part starts eight seconds later')
  assert.equal(allVocals[2].to.gain.value, .1)
  assert.equal(allVocals[2].to.to.gain.value, .1)
  chainContext.currentTime = 15.95
  tick()
  assert.ok(Math.abs(chainContext.sources.filter(source => source.buffer.vocal)[4].at - 16.04) < 1e-9, 'the whole arrangement loops')
  chainEngine.stop()

  // Recording and auditioning the current section starts immediately, not after the history.
  await chainEngine.start(newest, 1)
  const ownPreview = chainContext.sources.filter(source => source.buffer.vocal).slice(-2)
  assert.equal(ownPreview.length, 2)
  assert.ok(ownPreview.every(source => Math.abs(source.at - 15.99) < 1e-9))
  assert.equal(ownPreview[0].to.to.gain.value, .5)
  chainEngine.stop()

})


test('drag edits snap or move freely and trimming preserves source audio and the opposite edge', () => {
  const trimmed = { ...harmony, startStep: 8, trimStart: 1, trimEnd: 5 }
  assert.equal(editClipGesture(trimmed, 120, 'move', 2.3, true).startStep, 10)
  assert.equal(editClipGesture(trimmed, 120, 'move', 2.3, false).startStep, 10.3)
  assert.equal(editClipGesture(trimmed, 120, 'move', -100, false).startStep, 0)
  const left = editClipGesture(trimmed, 120, 'left', 4, true)
  assert.equal(left.startStep, 12)
  assert.equal(left.trimStart, 1.5)
  assert.equal(left.trimEnd, 5)
  assert.equal(clipTiming(left, 120).startSeconds + clipTiming(left, 120).duration, 5)
  const right = editClipGesture(trimmed, 120, 'right', -4, true)
  assert.equal(right.trimEnd, 4.5)
  assert.equal(right.trimStart, 1)
  assert.equal(right.startStep, 8)
  assert.equal(editClipGesture(trimmed, 120, 'right', 200, false).trimEnd, 8)
  assert.ok(clipTiming(editClipGesture(trimmed, 120, 'left', 200, false), 120).duration >= 0.019)
  assert.equal(clipTiming({ ...right, bpm: 240 }, 120).offset, 1)
  assert.equal(clipTiming({ ...right, bpm: 240 }, 120).duration, 1.75)
  assert.equal(right.voice, voice)
})

test('fractional positions and trims persist while invalid source boundaries are rejected', () => {
  const edited = { ...song, vocals: [{ ...lead, startStep: 3.25, trimStart: 0.5, trimEnd: 2.25 }] }
  assert.deepEqual(validateSong(edited), edited)
  for (const patch of [{ trimStart: -1 }, { trimEnd: 9 }, { trimStart: 3, trimEnd: 2 }, { trimStart: NaN }, { trimEnd: Infinity }, { trimEnd: 0.001 }]) assert.throws(() => validateSong({ ...song, vocals: [{ ...lead, ...patch }] }))
})
