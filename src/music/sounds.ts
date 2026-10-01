import type { Instrument } from './pattern'

const voices: Record<Instrument, { seconds: number; peak: number; seed: number }> = {
  kick: { seconds: 0.5, peak: 0.92, seed: 11 },
  snare: { seconds: 0.3, peak: 0.72, seed: 23 },
  hat: { seconds: 0.085, peak: 0.3, seed: 37 },
  clap: { seconds: 0.32, peak: 0.62, seed: 47 },
  openHat: { seconds: 0.49, peak: 0.34, seed: 59 },
  tom: { seconds: 0.48, peak: 0.76, seed: 71 },
  rimshot: { seconds: 0.13, peak: 0.52, seed: 83 },
  cowbell: { seconds: 0.27, peak: 0.42, seed: 97 },
}
const tau = Math.PI * 2
const sine = (hz: number, t: number) => Math.sin(tau * hz * t)
const envelope = (t: number, attack: number, decay: number) => (1 - Math.exp(-t / attack)) * Math.exp(-t / decay)

// Two-pole filters shape the noise before it reaches the transient and tail.
function filter(kind: 'low' | 'high', hz: number, rate: number, q = 0.707) {
  const omega = tau * Math.min(hz, rate * 0.44) / rate
  const cos = Math.cos(omega), alpha = Math.sin(omega) / (2 * q)
  const a0 = 1 + alpha, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0
  const b0 = (kind === 'low' ? 1 - cos : 1 + cos) / 2 / a0
  const b1 = (kind === 'low' ? 1 - cos : -(1 + cos)) / a0
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x: number) => {
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    return y
  }
}

// Original synthesized kit. Fixed noise seeds keep a saved song's timbre
// identical in the studio and results instead of rebuilding a random kit.
export function synthesizeDrum(id: Instrument, sampleRate: number): Float32Array {
  const voice = voices[id]
  const data = new Float32Array(Math.ceil(sampleRate * voice.seconds))
  let seed = voice.seed
  const noise = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) / 2147483648 - 1
  }
  const brightHigh = filter('high', id === 'hat' || id === 'openHat' ? 5200 : 1400, sampleRate)
  const brightLow = filter('low', 11500, sampleRate)
  const bodyHigh = filter('high', 650, sampleRate)
  const bodyLow = filter('low', 3200, sampleRate)
  const dc = filter('high', 15, sampleRate)
  const polish = filter('low', 14000, sampleRate)
  let peak = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate
    const n = noise()
    const air = brightLow(brightHigh(n))
    const body = bodyLow(bodyHigh(n))
    let sample = 0
    switch (id) {
      case 'kick': {
        // Fast beater, a descending chest hit, then a stable low fundamental.
        const phase = tau * (49 * t + 105 * 0.018 * (1 - Math.exp(-t / 0.018)))
        const sub = Math.sin(phase) * envelope(t, 0.0007, 0.115)
        const weight = Math.sin(phase * 2) * envelope(t, 0.001, 0.045) * 0.18
        const beater = body * envelope(t, 0.00025, 0.006) * 0.2
        sample = Math.tanh((sub + weight) * 1.45) * 0.8 + beater
        break
      }
      case 'snare': {
        const shell = (sine(185, t) * 0.65 + sine(330, t) * 0.22) * envelope(t, 0.0006, 0.034)
        const wires = (air * 0.55 + body * 0.75) * envelope(t, 0.001, 0.066)
        const crack = air * envelope(t, 0.0002, 0.007) * 0.45
        sample = Math.tanh((shell + wires + crack) * 1.2)
        break
      }
      case 'hat':
      case 'openHat': {
        // Inharmonic partials add a metallic shimmer without a square-wave fizz.
        const metal = [4310, 5870, 7130, 8290, 10130].reduce((sum, hz, index) => sum + sine(Math.min(hz, sampleRate * 0.42), t) / (index + 2), 0)
        const open = id === 'openHat'
        const tail = envelope(t, 0.0005, open ? 0.105 : 0.018)
        sample = (air * 0.85 + metal * 0.12) * tail + air * envelope(t, 0.0002, 0.004) * 0.18
        break
      }
      case 'clap': {
        let hands = 0
        for (const [offset, level] of [[0, 0.8], [0.009, 0.65], [0.021, 1]]) {
          const local = t - offset
          if (local >= 0) hands += envelope(local, 0.00045, 0.006) * level
        }
        const tail = t > 0.022 ? envelope(t - 0.022, 0.003, 0.061) * 0.55 : 0
        sample = (body * 0.95 + air * 0.22) * (hands + tail)
        break
      }
      case 'tom': {
        const phase = tau * (87 * t + 78 * 0.026 * (1 - Math.exp(-t / 0.026)))
        const skin = Math.sin(phase) * envelope(t, 0.0009, 0.105)
        const shell = Math.sin(phase * 1.59) * envelope(t, 0.001, 0.056) * 0.22
        sample = Math.tanh((skin + shell) * 1.15) + body * envelope(t, 0.0003, 0.006) * 0.14
        break
      }
      case 'rimshot':
        sample = (sine(780, t) * 0.6 + sine(1730, t) * 0.32 + sine(2460, t) * 0.14) * envelope(t, 0.00025, 0.014) + body * envelope(t, 0.0002, 0.004) * 0.5
        break
      case 'cowbell': {
        const bell = sine(540, t) * 0.55 + sine(810, t) * 0.42 + sine(1620, t) * 0.12 + sine(2170, t) * 0.07
        sample = Math.tanh(bell * 1.2) * envelope(t, 0.0005, 0.054) + body * envelope(t, 0.0003, 0.005) * 0.13
        break
      }
    }
    const fade = Math.min(1, i / (sampleRate * 0.0002), (data.length - 1 - i) / (sampleRate * 0.012))
    data[i] = polish(dc(sample)) * fade
    peak = Math.max(peak, Math.abs(data[i]))
  }
  // Calibrate each voice separately; hats leave space for drums and vocals.
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= voice.peak / peak
  return data
}
