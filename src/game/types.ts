import type { PianoTrack } from '../music/piano.ts'
import type { Mix, VocalClip } from '../music/arrangement.ts'
import type { VoiceTrack } from '../music/voice.ts'
import type { Pattern } from '../music/pattern.ts'
export const MUSIC_DURATION_MS = 10 * 60 * 1000
export const MAX_PROMPT_LENGTH = 240
// layers holds earlier sections in chronological order; each section is four bars.
export type Song = { pattern: Pattern; bpm: number; voice?: VoiceTrack; mix?: Mix; vocals?: VocalClip[]; piano?: PianoTrack; layers?: Song[] }
export type Result = { playerId: string; name: string; prompt: string; promptAuthor: string; song: Song; automatic: boolean; chainIndex: number; contribution: number; contributionTotal: number }
export type RevealEntry = Omit<Result, 'song'> & { bpm: number }
export type Reveal = { index: number; playing: boolean; revision: number }
export type GameView = {
  audioPending?: boolean
  reveal: Reveal
  id: string
  phase: 'prompts' | 'music' | 'results'
  deadline: number | null
  serverNow: number
  round: number
  rounds: number
  revealTotal: number
  total: number
  completed: number
  mine: { prompt: string | null; promptSubmitted: boolean; submitted: boolean; song: Song } | null
  revealHistory: RevealEntry[]
  results: Result[]
}
