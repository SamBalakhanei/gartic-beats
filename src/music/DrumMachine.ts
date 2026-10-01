import { instruments, STEP_SECONDS, TOTAL_STEPS } from './pattern'
import type { Instrument, Pattern } from './pattern'

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
  private pattern: Pattern
  private onStep: (step: number) => void
  private onPlaying: (playing: boolean) => void

  constructor(pattern: Pattern, onStep: (step: number) => void, onPlaying: (playing: boolean) => void) {
    this.pattern = pattern
    this.onStep = onStep
    this.onPlaying = onPlaying
  }

  setPattern(pattern: Pattern) { this.pattern = pattern }

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
      this.output.connect(this.context.destination)
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
    const duration = { kick: 0.45, snare: 0.22, hat: 0.07, cowbell: 0.18 }[id]
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate)
    const data = buffer.getChannelData(0)
    let lastNoise = 0
    for (let i = 0; i < data.length; i++) {
      const t = i / context.sampleRate
      const attack = Math.min(1, t / 0.002)
      const noise = Math.random() * 2 - 1
      if (id === 'kick') {
        const phase = 2 * Math.PI * (48 * t + 110 * 0.025 * (1 - Math.exp(-t / 0.025)))
        data[i] = Math.sin(phase) * Math.exp(-t * 12) * attack
      } else if (id === 'snare') {
        data[i] = (noise * 0.65 + Math.sin(2 * Math.PI * 180 * t) * 0.3) * Math.exp(-t * 24) * attack
      } else if (id === 'hat') {
        data[i] = (noise - lastNoise) * 0.22 * Math.exp(-t * 65) * attack
      } else {
        data[i] = (Math.sin(2 * Math.PI * 540 * t) + Math.sin(2 * Math.PI * 800 * t)) * 0.22 * Math.exp(-t * 28) * attack
      }
      lastNoise = noise
      // Bring the tail fully to zero to avoid a click at the buffer boundary.
      data[i] *= Math.min(1, (duration - t) / 0.01)
    }
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
    const origin = context.currentTime + 0.04
    let next = 0
    const schedule = () => {
      // Skip overdue steps after a main-thread stall instead of playing a burst.
      next = Math.max(next, Math.ceil((context.currentTime - origin) / STEP_SECONDS))
      while (origin + next * STEP_SECONDS < context.currentTime + 0.1) {
        const step = next % TOTAL_STEPS
        for (const { id } of instruments) {
          if (this.pattern[id][step]) this.hit(id, origin + next * STEP_SECONDS)
        }
        next++
      }
    }
    let previous = -1
    const animate = () => {
      const elapsed = context.currentTime - origin
      const step = elapsed < 0 ? -1 : Math.floor(elapsed / STEP_SECONDS) % TOTAL_STEPS
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
