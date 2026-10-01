import { instruments, TOTAL_STEPS } from './pattern'
import type { Instrument, Pattern } from './pattern'
import { synthesizeDrum } from './sounds'
import { DEFAULT_BPM, normalizeBpm, StepClock } from './tempo'

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
    source.connect(this.output!)
    this.sources.add(source)
    source.onended = () => { source.disconnect(); this.sources.delete(source) }
    source.start(at)
  }

  async preview(id: Instrument) {
    const generation = this.generation
    const context = await this.ready()
    if (!this.disposed && generation === this.generation) this.hit(id, context.currentTime)
  }

  async start() {
    this.stop()
    const generation = this.generation
    const context = await this.ready()
    if (this.disposed || generation !== this.generation || document.hidden) return
    const clock = new StepClock(context.currentTime + 0.04, TOTAL_STEPS)
    const schedule = () => {
      for (const { at, step } of clock.schedule(context.currentTime, this.bpm)) {
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
  }

  stop() {
    this.generation++
    clearInterval(this.timer)
    this.timer = undefined
    cancelAnimationFrame(this.frame)
    for (const source of this.sources) { source.stop(); source.disconnect() }
    this.sources.clear()
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
