import type { Pattern } from '../music/pattern.ts'
export const MUSIC_DURATION_MS = 10 * 60 * 1000
export const MAX_PROMPT_LENGTH = 240
export type Song = { pattern: Pattern; bpm: number }
export type Result = { playerId: string; name: string; prompt: string; promptAuthor: string; song: Song; automatic: boolean }
export type GameView = {
  id: string
  phase: 'prompts' | 'music' | 'results'
  deadline: number | null
  serverNow: number
  total: number
  completed: number
  mine: { prompt: string | null; promptSubmitted: boolean; submitted: boolean; song: Song } | null
  results: Result[]
}
