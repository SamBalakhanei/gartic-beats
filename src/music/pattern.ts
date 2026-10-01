export const BPM = 120
export const BARS = 4
export const STEPS_PER_BAR = 16
export const TOTAL_STEPS = BARS * STEPS_PER_BAR
export const STEP_SECONDS = 60 / BPM / 4

export const instruments = [
  { id: 'kick', name: 'Kick', hint: 'The heartbeat', color: '#c2ff8a' },
  { id: 'snare', name: 'Snare', hint: 'A little snap', color: '#bba4ff' },
  { id: 'hat', name: 'Hi-hat', hint: 'Keep it moving', color: '#ffd178' },
  { id: 'cowbell', name: 'Cowbell', hint: 'More cowbell', color: '#ff96b1' },
] as const

export type Instrument = typeof instruments[number]['id']
export type Pattern = Record<Instrument, boolean[]>
export type Preset = 'sneaky' | 'dance' | 'clumsy'

export function emptyPattern(): Pattern {
  return Object.fromEntries(instruments.map(({ id }) => [id, Array<boolean>(TOTAL_STEPS).fill(false)])) as Pattern
}

export function toggleStep(pattern: Pattern, instrument: Instrument, step: number): Pattern {
  return { ...pattern, [instrument]: pattern[instrument].map((on, index) => index === step ? !on : on) }
}

export function clearBar(pattern: Pattern, bar: number): Pattern {
  const start = bar * STEPS_PER_BAR
  return Object.fromEntries(instruments.map(({ id }) => [
    id, pattern[id].map((on, index) => index >= start && index < start + STEPS_PER_BAR ? false : on),
  ])) as Pattern
}

export function createPreset(preset: Preset): Pattern {
  const pattern = emptyPattern()
  const hits: Record<Preset, Record<Instrument, number[]>> = {
    sneaky: { kick: [0, 10], snare: [4, 12], hat: [2, 6, 10, 14], cowbell: [15] },
    dance: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], cowbell: [6, 14] },
    clumsy: { kick: [0, 7, 10], snare: [5, 12], hat: [0, 3, 8, 11, 14], cowbell: [6, 15] },
  }
  for (let bar = 0; bar < BARS; bar++) {
    for (const { id } of instruments) {
      for (const step of hits[preset][id]) pattern[id][bar * STEPS_PER_BAR + step] = true
    }
  }
  return pattern
}
