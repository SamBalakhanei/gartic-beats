export const BPM = 120
export const BARS = 4
export const STEPS_PER_BAR = 16
export const TOTAL_STEPS = BARS * STEPS_PER_BAR
export const STEP_SECONDS = 60 / BPM / 4

export const instruments = [
  { id: 'kick', name: 'Kick', hint: 'The heartbeat', color: '#c2ff8a' },
  { id: 'snare', name: 'Snare', hint: 'A little snap', color: '#bba4ff' },
  { id: 'hat', name: 'Hi-hat', hint: 'Keep it moving', color: '#ffd178' },
  { id: 'clap', name: 'Clap', hint: 'Hands together', color: '#82dfed' },
  { id: 'openHat', name: 'Open hi-hat', hint: 'Let it ring', color: '#ffad73' },
  { id: 'tom', name: 'Low tom', hint: 'A round rumble', color: '#89baff' },
  { id: 'rimshot', name: 'Rimshot', hint: 'A woody click', color: '#e7abed' },
  { id: 'cowbell', name: 'Cowbell', hint: 'More cowbell', color: '#ff96b1' },
] as const

export type Instrument = typeof instruments[number]['id']
export type Pattern = Record<Instrument, boolean[]>
export type Preset = 'soul' | 'stadium' | 'industrial'

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

// Original drum sketches: a soulful pocket, a broad anthem groove, and
// sparse industrial percussion. Each phrase develops over all four bars.
// Unlisted voices stay silent so the starter leaves room for the player.
const presetBars: Record<Preset, [BarHits, BarHits, BarHits, BarHits]> = {
  soul: [
    { kick: [0, 6, 11], snare: [8], hat: [0, 3, 4, 6, 8, 11, 12, 14], rimshot: [15] },
    { kick: [0, 5, 6, 14], snare: [8], hat: [0, 2, 4, 7, 8, 10, 12, 15] },
    { kick: [0, 6, 10, 11], snare: [8], hat: [0, 3, 4, 6, 8, 11, 12, 14], rimshot: [7] },
    { kick: [0, 6, 14], snare: [8], hat: [0, 3, 4, 6, 8, 10, 12], openHat: [14], rimshot: [15] },
  ],
  stadium: [
    { kick: [0, 3, 8, 10], snare: [4, 12], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], openHat: [14] },
    { kick: [0, 6, 8, 11], snare: [4, 12], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
    { kick: [0, 3, 8, 10, 15], snare: [4, 12], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12], openHat: [14] },
    { kick: [0, 6, 8], snare: [4, 12], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10], tom: [13, 14, 15] },
  ],
  industrial: [
    { kick: [0, 1, 6, 8], snare: [8], rimshot: [3, 11], openHat: [14] },
    { kick: [0, 6, 7], clap: [8], rimshot: [2, 10, 15], cowbell: [12] },
    { kick: [0, 1, 6, 8, 14], snare: [8], rimshot: [3, 11], openHat: [15] },
    { kick: [0, 1], clap: [8], tom: [12, 13], rimshot: [15] },
  ],
}

type BarHits = Partial<Record<Instrument, number[]>>

export function createPreset(preset: Preset): Pattern {
  const pattern = emptyPattern()
  presetBars[preset].forEach((hits, bar) => {
    for (const { id } of instruments) {
      for (const step of hits[id] ?? []) pattern[id][bar * STEPS_PER_BAR + step] = true
    }
  })
  return pattern
}
