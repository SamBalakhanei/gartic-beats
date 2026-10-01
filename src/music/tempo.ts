export const DEFAULT_BPM = 120
export const MIN_BPM = 40
export const MAX_BPM = 240

export function normalizeBpm(value: number, fallback = DEFAULT_BPM): number {
  return Number.isFinite(value) ? Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(value))) : fallback
}

export function stepSeconds(bpm: number): number {
  return 60 / normalizeBpm(bpm) / 4
}

type StepEvent = { at: number; step: number }

// One timeline drives both scheduled audio and the visual playhead. Tempo
// changes affect future steps; already queued notes keep their timestamps.
export class StepClock {
  private nextAt: number
  private nextStep = 0
  private queue: StepEvent[] = []
  private current = -1
  private totalSteps: number

  constructor(startAt: number, totalSteps: number) {
    this.nextAt = startAt
    this.totalSteps = totalSteps
  }

  schedule(now: number, bpm: number): StepEvent[] {
    const interval = stepSeconds(bpm)
    if (this.nextAt < now) {
      const skipped = Math.ceil((now - this.nextAt) / interval)
      this.nextAt += skipped * interval
      this.nextStep += skipped
    }
    const events: StepEvent[] = []
    while (this.nextAt < now + 0.1) {
      const event = { at: this.nextAt, step: this.nextStep % this.totalSteps }
      events.push(event)
      this.queue.push(event)
      this.nextAt += interval
      this.nextStep++
    }
    return events
  }

  position(now: number): number {
    while (this.queue.length && this.queue[0].at <= now) this.current = this.queue.shift()!.step
    return this.current
  }
}
