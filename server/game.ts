import { randomInt, randomUUID } from 'node:crypto'
import { emptyPattern, instruments, TOTAL_STEPS } from '../src/music/pattern.ts'
import { DEFAULT_BPM, MIN_BPM, MAX_BPM } from '../src/music/tempo.ts'
import { MAX_PROMPT_LENGTH, MUSIC_DURATION_MS } from '../src/game/types.ts'
import type { GameView, Song } from '../src/game/types.ts'

type Participant = { id: string; name: string; prompt: string | null; owner: string | null; song: Song; submitted: boolean; automatic: boolean; absent: boolean }
export type Game = { id: string; phase: GameView['phase']; deadline: number | null; players: Participant[] }

export function createGame(players: { id: string; name: string }[]): Game {
  if (players.length < 2) throw new Error('At least two connected players are needed.')
  return { id: randomUUID(), phase: 'prompts', deadline: null, players: players.map(player => ({ id: player.id, name: player.name, prompt: null, owner: null, song: { pattern: emptyPattern(), bpm: DEFAULT_BPM }, submitted: false, automatic: false, absent: false })) }
}

// A shuffled cycle uses each prompt once and cannot assign a prompt to its author.
export function assignPrompts(game: Game, now: number, duration = MUSIC_DURATION_MS) {
  if (game.phase !== 'prompts' || game.players.some(player => player.prompt === null)) return
  const shuffled = [...game.players]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = randomInt(index + 1)
    ;[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]]
  }
  shuffled.forEach((player, index) => { player.owner = shuffled[(index + 1) % shuffled.length].id })
  game.phase = 'music'
  game.deadline = now + duration
  for (const player of game.players) if (player.absent) { player.submitted = true; player.automatic = true }
  finishIfReady(game, now)
}

export function finishIfReady(game: Game, now: number) {
  if (game.phase !== 'music') return
  if (now >= game.deadline! || game.players.every(player => player.submitted)) {
    for (const player of game.players) if (!player.submitted) { player.submitted = true; player.automatic = true }
    game.phase = 'results'
  }
}

export function submitPrompt(game: Game, id: string, text: unknown, now: number, duration = MUSIC_DURATION_MS) {
  const player = game.players.find(item => item.id === id)
  if (game.phase !== 'prompts' || !player || player.prompt !== null) throw new Error('This prompt turn has already ended.')
  if (typeof text !== 'string' || !text.trim() || text.trim().length > MAX_PROMPT_LENGTH) throw new Error('Write a prompt between 1 and 240 characters.')
  player.prompt = text.trim()
  assignPrompts(game, now, duration)
}

export function validateSong(value: unknown): Song {
  if (!value || typeof value !== 'object') throw new Error('Invalid song.')
  const { pattern, bpm } = value as Partial<Song>
  if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < MIN_BPM || bpm > MAX_BPM || !pattern || typeof pattern !== 'object') throw new Error('Invalid song tempo or pattern.')
  const clean = emptyPattern()
  for (const { id } of instruments) {
    if (!Array.isArray(pattern[id]) || pattern[id].length !== TOTAL_STEPS || !pattern[id].every(step => typeof step === 'boolean')) throw new Error('Invalid song steps.')
    clean[id] = [...pattern[id]]
  }
  return { bpm, pattern: clean }
}

export function saveSong(game: Game, id: string, value: unknown, submit: boolean, now: number) {
  finishIfReady(game, now)
  const player = game.players.find(item => item.id === id)
  if (game.phase !== 'music' || !player || player.submitted) throw new Error('This song turn has already ended.')
  player.song = validateSong(value)
  if (submit) player.submitted = true
  finishIfReady(game, now)
}

export function departGame(game: Game, id: string, now: number, duration = MUSIC_DURATION_MS) {
  const player = game.players.find(item => item.id === id)
  if (!player || game.phase === 'results') return
  player.absent = true
  if (game.phase === 'prompts') {
    player.prompt ??= 'A tiny robot throwing a surprise party'
    assignPrompts(game, now, duration)
  } else {
    if (!player.submitted) { player.submitted = true; player.automatic = true }
    finishIfReady(game, now)
  }
}

export function gameView(game: Game, id: string, now: number): GameView {
  const player = game.players.find(item => item.id === id)
  const owner = game.players.find(item => item.id === player?.owner)
  return {
    id: game.id, phase: game.phase, deadline: game.deadline, serverNow: now,
    total: game.players.length,
    completed: game.players.filter(item => game.phase === 'prompts' ? item.prompt !== null : item.submitted).length,
    mine: player ? { prompt: game.phase === 'prompts' ? player.prompt : owner?.prompt ?? null, promptSubmitted: player.prompt !== null, submitted: player.submitted, song: player.song } : null,
    results: game.phase === 'results' ? game.players.map(item => {
      const author = game.players.find(source => source.id === item.owner)!
      return { playerId: item.id, name: item.name, prompt: author.prompt!, promptAuthor: author.name, song: item.song, automatic: item.automatic }
    }) : [],
  }
}
