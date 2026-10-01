import type { Instrument } from './pattern'

const durations: Record<Instrument, number> = {
  kick: 0.45, snare: 0.22, hat: 0.07, clap: 0.25,
  openHat: 0.42, tom: 0.4, rimshot: 0.09, cowbell: 0.18,
}

// Keep synthesis independent of the browser so every voice can be checked
// at different sample rates without opening an AudioContext.
export function synthesizeDrum(id: Instrument, sampleRate: number): Float32Array {
  const duration = durations[id]
  const data = new Float32Array(Math.ceil(sampleRate * duration))
  let lastNoise = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate
    const attack = Math.min(1, t / 0.002)
    const noise = Math.random() * 2 - 1
    const highNoise = noise - lastNoise
    let sample: number
    switch (id) {
      case 'kick': {
        const phase = 2 * Math.PI * (48 * t + 110 * 0.025 * (1 - Math.exp(-t / 0.025)))
        sample = Math.sin(phase) * Math.exp(-t * 12) * attack
        break
      }
      case 'snare':
        sample = (noise * 0.65 + Math.sin(2 * Math.PI * 180 * t) * 0.3) * Math.exp(-t * 24) * attack
        break
      case 'hat':
        sample = highNoise * 0.22 * Math.exp(-t * 65) * attack
        break
      case 'clap': {
        // Three quick noise bursts imitate several hands landing together.
        let envelope = 0
        for (const offset of [0, 0.012, 0.024]) {
          const elapsed = t - offset
          if (elapsed >= 0) envelope += Math.min(1, elapsed / 0.001) * Math.exp(-elapsed * 180)
        }
        if (t >= 0.024) envelope += (1 - Math.exp(-(t - 0.024) * 400)) * Math.exp(-(t - 0.024) * 28) * 0.55
        sample = highNoise * envelope * 0.26
        break
      }
      case 'openHat': {
        const metal = Math.sin(2 * Math.PI * 6240 * t) * Math.sin(2 * Math.PI * 8700 * t)
        sample = (highNoise * 0.17 + metal * 0.1) * Math.exp(-t * 10) * attack
        break
      }
      case 'tom': {
        const phase = 2 * Math.PI * (95 * t + 65 * 0.045 * (1 - Math.exp(-t / 0.045)))
        sample = (Math.sin(phase) * 0.7 + Math.sin(phase * 1.52) * 0.12) * Math.exp(-t * 13) * attack
        break
      }
      case 'rimshot':
        sample = (Math.sin(2 * Math.PI * 920 * t) * 0.45 + Math.sin(2 * Math.PI * 1640 * t) * 0.25 + noise * 0.15) * Math.exp(-t * 65) * attack
        break
      case 'cowbell':
        sample = (Math.sin(2 * Math.PI * 540 * t) + Math.sin(2 * Math.PI * 800 * t)) * 0.22 * Math.exp(-t * 28) * attack
        break
    }
    lastNoise = noise
    // Fade the final 10 ms completely to zero to avoid a boundary click.
    data[i] = sample * Math.min(1, (data.length - 1 - i) / (sampleRate * 0.01))
  }
  return data
}
