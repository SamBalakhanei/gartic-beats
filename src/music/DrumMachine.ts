import { emptyPiano, noteMidi, synthesizePiano } from './piano.ts'
import type { PianoTrack, PianoNote } from './piano.ts'
import { voiceBytes } from './voice.ts'
import type { Song } from '../game/types'
import { clipTiming, DEFAULT_MIX, songVocals } from './arrangement.ts'
import type { Mix, VocalClip } from './arrangement.ts'
import { instruments, TOTAL_STEPS } from './pattern.ts'
import type { Instrument, Pattern } from './pattern.ts'
import { synthesizeDrum } from './sounds.ts'
import { DEFAULT_BPM, normalizeBpm, StepClock } from './tempo.ts'

// Schedule against the audio clock, not animation frames. The short lookahead
// keeps timing steady while letting edits take effect during playback.
export class DrumMachine {
  private context: AudioContext | null = null
  private output: GainNode | null = null
  private buffers = new Map<Instrument, AudioBuffer>()
  private sources = new Set<AudioBufferSourceNode>()
  private timer: ReturnType<typeof setInterval> | undefined
  private frame = 0
  private generation = 0
  private disposed = false
  private volume = 0.65
  private bpm = DEFAULT_BPM
  private piano: PianoTrack = emptyPiano()
  private pianoBus: GainNode | null = null
  private pianoBuffers = new Map<string, AudioBuffer>()
  private beatBus: GainNode | null = null
  private voiceBus: GainNode | null = null
  private mix: Mix = { ...DEFAULT_MIX }
  private vocals: VocalClip[] = []
  private vocalGains = new Map<string, Set<GainNode>>()
  private pattern: Pattern
  private onStep: (step: number) => void
  private onPlaying: (playing: boolean) => void

  constructor(pattern: Pattern, onStep: (step: number) => void, onPlaying: (playing: boolean) => void) {
    this.pattern = pattern
    this.onStep = onStep
    this.onPlaying = onPlaying
  }

  setPattern(pattern: Pattern) { this.pattern = pattern }

  setBpm(bpm: number) { this.bpm = normalizeBpm(bpm, this.bpm) }

  setMix(mix: Mix, vocals = this.vocals) {
    this.mix = mix
    this.vocals = vocals
    if (!this.context) return
    this.beatBus?.gain.setTargetAtTime(mix.beat, this.context.currentTime, 0.015)
    this.voiceBus?.gain.setTargetAtTime(mix.voice, this.context.currentTime, 0.015)
    for (const clip of vocals) for (const gain of this.vocalGains.get(clip.id) ?? []) gain.gain.setTargetAtTime(clip.volume, this.context.currentTime, 0.015)
  }

  setSong(song: Song) {
    this.piano = song.piano ?? emptyPiano()
    if (this.context) this.pianoBus?.gain.setTargetAtTime(this.piano.volume, this.context.currentTime, 0.015)
    this.setPattern(song.pattern)
    this.setBpm(song.bpm)
    this.setMix(song.mix ?? DEFAULT_MIX, songVocals(song))
  }

  async prepare() { await this.ready() }

  setVolume(volume: number) {
    this.volume = volume
    if (this.context && this.output) {
      this.output.gain.setTargetAtTime(volume * 0.5, this.context.currentTime, 0.015)
    }
  }

  private async ready() {
    if (this.disposed) throw new Error('The drum editor has closed.')
    if (!this.context) {
      if (!window.AudioContext) throw new Error('Audio is not available in this browser. Try a recent Chrome, Firefox, or Safari.')
      this.context = new AudioContext()
      this.output = this.context.createGain()
      this.output.gain.value = this.volume * 0.5
      this.beatBus = this.context.createGain()
      this.voiceBus = this.context.createGain()
      this.beatBus.gain.value = this.mix.beat
      this.voiceBus.gain.value = this.mix.voice
      this.beatBus.connect(this.output)
      this.voiceBus.connect(this.output)
      this.pianoBus = this.context.createGain()
      this.pianoBus.gain.value = this.piano.volume
      this.pianoBus.connect(this.output)
      // Tame peaks when several of the eight voices overlap.
      const compressor = this.context.createDynamicsCompressor()
      compressor.threshold.value = -8
      compressor.knee.value = 8
      compressor.ratio.value = 12
      compressor.attack.value = 0.003
      compressor.release.value = 0.12
      this.output.connect(compressor)
      compressor.connect(this.context.destination)
      this.context.onstatechange = () => {
        if (this.context?.state !== 'running') this.stop()
      }
      for (const { id } of instruments) this.buffers.set(id, this.makeSound(id))
    }
    await this.context.resume()
    if (this.context.state !== 'running') throw new Error('Sound could not start. Press Play to try again.')
    return this.context
  }

  private makeSound(id: Instrument) {
    const context = this.context!
    const samples = synthesizeDrum(id, context.sampleRate)
    const buffer = context.createBuffer(1, samples.length, context.sampleRate)
    buffer.getChannelData(0).set(samples)
    return buffer
  }

  private hit(id: Instrument, at: number) {
    const source = this.context!.createBufferSource()
    source.buffer = this.buffers.get(id)!
    source.connect(this.beatBus!)
    this.sources.add(source)
    source.onended = () => { source.disconnect(); this.sources.delete(source) }
    source.start(at)
  }

  private pianoHit(note: PianoNote, at: number, preview = false) {
    const context = this.context!
    const midi = noteMidi(this.piano, note.degree)
    const remaining = (64 - note.start) * 15 / this.bpm
    const gate = Math.min(note.length * 15 / this.bpm * 0.9, remaining)
    const key = `${midi}:${gate}:${this.piano.warmth}`
    let buffer = this.pianoBuffers.get(key)
    if (!buffer) {
      const samples = synthesizePiano(midi, context.sampleRate, gate, this.piano.warmth)
      buffer = context.createBuffer(1, samples.length, context.sampleRate)
      buffer.getChannelData(0).set(samples)
      if (this.pianoBuffers.size >= 128) this.pianoBuffers.clear()
      this.pianoBuffers.set(key, buffer)
    }
    const source = context.createBufferSource(), gain = context.createGain()
    source.buffer = buffer; gain.gain.value = note.velocity * 0.75
    source.connect(gain); gain.connect(this.pianoBus!)
    this.sources.add(source)
    source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source) }
    source.start(at)
    if (!preview) source.stop(at + Math.min(buffer.duration, remaining - (note.start % 2 ? this.piano.swing * 15 / this.bpm : 0)))
  }
  async previewPiano(degree: number) {
    const generation = this.generation
    const context = await this.ready()
    if (!this.disposed && generation === this.generation) this.pianoHit({ id: 'preview', degree, start: 0, length: 4, velocity: 0.8 }, context.currentTime, true)
  }

  async preview(id: Instrument) {
    const generation = this.generation
    const context = await this.ready()
    if (!this.disposed && generation === this.generation) this.hit(id, context.currentTime)
  }

  async start(song?: Song) {
    this.stop()
    if (song) this.setSong(song)
    const generation = this.generation
    const context = await this.ready()
    if (this.disposed || generation !== this.generation || document.hidden) return
    const buffers = new Map<string, AudioBuffer>()
    await Promise.all(this.vocals.map(async clip => {
      buffers.set(clip.id, await context.decodeAudioData(voiceBytes(clip.voice.data).buffer as ArrayBuffer))
    }))
    if (this.disposed || generation !== this.generation || document.hidden) return
    const origin = context.currentTime + 0.04
    const clock = new StepClock(origin, TOTAL_STEPS)
    const playClip = (clip: VocalClip, at: number) => {
      const buffer = buffers.get(clip.id)
      if (!buffer) return
      const source = context.createBufferSource()
      const gain = context.createGain()
      const timing = clipTiming(clip, this.bpm)
      source.buffer = buffer
      source.playbackRate.value = timing.rate
      gain.gain.value = clip.volume
      source.connect(gain); gain.connect(this.voiceBus!)
      const gains = this.vocalGains.get(clip.id) ?? new Set<GainNode>()
      gains.add(gain); this.vocalGains.set(clip.id, gains)
      this.sources.add(source)
      source.onended = () => { source.disconnect(); gain.disconnect(); gains.delete(gain); this.sources.delete(source) }
      source.start(at, timing.offset)
      // The four-bar arrangement repeats; trim any tail at its right edge.
      source.stop(at + timing.audibleSeconds)
    }
    const schedule = () => {
      for (const { at, step } of clock.schedule(context.currentTime, this.bpm)) {
        for (const note of this.piano.notes) if (note.start === step) this.pianoHit(note, at + (step % 2 ? this.piano.swing * 15 / this.bpm : 0))
        for (const clip of this.vocals) if (Math.floor(clip.startStep) === step) playClip(clip, at + (clip.startStep % 1) * 15 / this.bpm)
        for (const { id } of instruments) {
          if (this.pattern[id][step]) this.hit(id, at)
        }
      }
    }
    let previous = -1
    const animate = () => {
      const step = clock.position(context.currentTime)
      if (step !== previous) { this.onStep(step); previous = step }
      this.frame = requestAnimationFrame(animate)
    }
    schedule()
    this.timer = setInterval(schedule, 25)
    this.onPlaying(true)
    animate()
    return performance.now() + (origin - context.currentTime) * 1000
  }

  stop() {
    this.generation++
    clearInterval(this.timer)
    this.timer = undefined
    cancelAnimationFrame(this.frame)
    for (const source of this.sources) { source.stop(); source.disconnect() }
    this.sources.clear()
    this.vocalGains.clear()
    this.onStep(-1)
    this.onPlaying(false)
  }

  dispose() {
    this.disposed = true
    this.stop()
    if (this.context) {
      this.context.onstatechange = null
      void this.context.close().catch(() => {})
    }
  }
}
