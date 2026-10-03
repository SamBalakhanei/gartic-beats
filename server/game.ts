import { validatePiano } from '../src/music/piano.ts'
import { MAX_VOCAL_LAYERS, MIN_SAMPLE_BPM, MAX_SAMPLE_BPM } from '../src/music/arrangement.ts'
import { validateVoice, validateVoiceReference } from '../src/music/voice.ts'
import { randomInt, randomUUID } from 'node:crypto'
import { emptyPattern, instruments, TOTAL_STEPS } from '../src/music/pattern.ts'
import { DEFAULT_BPM, MIN_BPM, MAX_BPM } from '../src/music/tempo.ts'
import { MAX_PROMPT_LENGTH, MUSIC_DURATION_MS, SUBMISSION_GRACE_MS } from '../src/game/types.ts'
import type { GameView, Song, Reveal } from '../src/game/types.ts'

type Contribution = { playerId: string; name: string; song: Song; automatic: boolean }
type Participant = { id: string; name: string; prompt: string | null; owner: string | null; song: Song; submitted: boolean; automatic: boolean; absent: boolean; contributions: Contribution[] }
export type Game = { submissionGrace?: number; revealed?: number; reveal: Reveal; id: string; phase: GameView['phase']; deadline: number | null; players: Participant[]; order: string[]; round: number; duration: number }
const freshSong = (bpm = DEFAULT_BPM): Song => ({ pattern: emptyPattern(), bpm })
const ownPart = ({ layers: _layers, ...song }: Song): Song => song

export function createGame(players: { id: string; name: string }[], submissionGrace = SUBMISSION_GRACE_MS): Game {
  if (players.length < 2 || players.length > 8) throw new Error('Two to eight connected players are needed.')
  return { submissionGrace, reveal: { index: 0, playing: false, revision: 0 }, id: randomUUID(), phase: 'prompts', deadline: null, order: [], round: 0, duration: MUSIC_DURATION_MS, players: players.map(player => ({ ...player, prompt: null, owner: null, song: freshSong(), submitted: false, automatic: false, absent: false, contributions: [] })) }
}

function beginRound(game: Game, now: number) {
  game.round++
  game.deadline = now + game.duration
  for (const player of game.players) {
    // Every nonzero offset visits a different author, never the player's own chain.
    player.owner = game.order[(game.order.indexOf(player.id) + game.round) % game.order.length]
    const chain = game.players.find(p => p.id === player.owner)!.contributions
    player.song = freshSong(chain[0]?.song.bpm)
    player.submitted = player.absent
    player.automatic = player.absent
  }
}

export function assignPrompts(game: Game, now: number, duration = MUSIC_DURATION_MS) {
  if (game.phase !== 'prompts' || game.players.some(player => player.prompt === null)) return
  game.order = game.players.map(p => p.id)
  for (let i = game.order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[game.order[i], game.order[j]] = [game.order[j], game.order[i]]
  }
  game.duration = duration
  game.phase = 'music'
  beginRound(game, now)
  finishIfReady(game, now)
}

export function finishIfReady(game: Game, now: number) {
  while (game.phase === 'music' && (now >= game.deadline! + (game.submissionGrace ?? SUBMISSION_GRACE_MS) || game.players.every(p => p.submitted))) {
    for (const player of game.players) {
      if (!player.submitted) { player.submitted = true; player.automatic = true }
      const owner = game.players.find(p => p.id === player.owner)!
      owner.contributions.push({ playerId: player.id, name: player.name, song: structuredClone(ownPart(player.song)), automatic: player.automatic })
    }
    if (game.round === game.players.length - 1) { game.phase = 'results'; game.deadline = null }
    else beginRound(game, now)
  }
}

export function submitPrompt(game: Game, id: string, text: unknown, now: number, duration = MUSIC_DURATION_MS) {
  const player = game.players.find(item => item.id === id)
  if (game.phase !== 'prompts' || !player || player.prompt !== null) throw new Error('This prompt turn has already ended.')
  if (typeof text !== 'string' || !text.trim() || text.trim().length > MAX_PROMPT_LENGTH) throw new Error('Write a prompt between 1 and 240 characters.')
  player.prompt = text.trim()
  assignPrompts(game, now, duration)
}

export function validateSong(value: unknown, referencesOnly = false): Song {
  const voiceValidator = referencesOnly ? validateVoiceReference : validateVoice
  if (!value || typeof value !== 'object') throw new Error('Invalid song.')
  const { pattern, bpm, voice, mix, vocals, piano } = value as Partial<Song>
  if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < MIN_BPM || bpm > MAX_BPM || !pattern || typeof pattern !== 'object') throw new Error('Invalid song tempo or pattern.')
  const clean = emptyPattern()
  for (const { id } of instruments) {
    if (!Array.isArray(pattern[id]) || pattern[id].length !== TOTAL_STEPS || !pattern[id].every(step => typeof step === 'boolean')) throw new Error('Invalid song steps.')
    clean[id] = [...pattern[id]]
  }
  const level = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  if (mix !== undefined && (!mix || !level(mix.beat) || !level(mix.voice))) throw new Error('Invalid beat or voice mix level.')
  if (vocals !== undefined && (!Array.isArray(vocals) || vocals.length > MAX_VOCAL_LAYERS)) throw new Error('Use up to four vocal layers.')
  const ids = new Set<string>()
  const validatedVocals = vocals?.map(clip => {
    if (!clip || typeof clip.id !== 'string' || !clip.id || clip.id.length > 64 || ids.has(clip.id) || typeof clip.name !== 'string' || !clip.name.trim() || clip.name.length > 32 ||
        !Number.isInteger(clip.bpm) || clip.bpm < MIN_SAMPLE_BPM || clip.bpm > MAX_SAMPLE_BPM || !Number.isFinite(clip.startStep) || clip.startStep < 0 || clip.startStep > 63 || !level(clip.volume)) throw new Error('Invalid vocal layer settings.')
    const track = voiceValidator(clip.voice)
    const start = clip.trimStart ?? 0, end = clip.trimEnd ?? 960 / track.bpm
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 960 / track.bpm || end - start < 0.019) throw new Error('Invalid vocal trim.')
    ids.add(clip.id)
    return { id: clip.id, name: clip.name.trim(), voice: track, bpm: clip.bpm, startStep: clip.startStep, volume: clip.volume, ...(clip.trimStart !== undefined ? { trimStart: start } : {}), ...(clip.trimEnd !== undefined ? { trimEnd: end } : {}) }
  })
  return { bpm, pattern: clean, ...(piano !== undefined ? { piano: validatePiano(piano) } : {}), ...(mix ? { mix: { beat: mix.beat, voice: mix.voice } } : {}), ...(validatedVocals ? { vocals: validatedVocals } : {}), ...(voice && !validatedVocals ? { voice: voiceValidator(voice) } : {}) }
}

export function saveSong(game: Game, id: string, value: unknown, submit: boolean, now: number, referencesOnly = false, round = game.round, automatic = false) {
  finishIfReady(game, now)
  const player = game.players.find(item => item.id === id)
  if (game.phase !== 'music' || round !== game.round || !player || player.submitted) throw new Error('This music turn has already ended.')
  const song = validateSong(value, referencesOnly)
  // Backing layers are authoritative: client-supplied layers are never saved.
  const layers = game.players.find(p => p.id === player.owner)!.contributions.map(p => p.song)
  if (layers?.length && song.bpm !== layers[0].bpm) throw new Error('Keep the tempo of the existing song.')
  player.song = song
  if (submit) { player.submitted = true; player.automatic = automatic }
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
  const rounds = game.players.length - 1
  const chainIndex = Math.floor(game.reveal.index / (rounds + 1))
  const contribution = game.reveal.index % (rounds + 1)
  const chain = game.players[chainIndex]
  const part = chain?.contributions[contribution - 1]
  return {
    reveal: { ...game.reveal }, id: game.id, phase: game.phase, deadline: game.deadline, serverNow: now,
    round: game.round, rounds, revealTotal: game.players.length * (rounds + 1),
    total: game.players.length,
    completed: game.players.filter(item => game.phase === 'prompts' ? item.prompt !== null : item.submitted).length,
    mine: player ? { prompt: game.phase === 'prompts' ? player.prompt : game.phase === 'music' && game.round === 1 ? owner?.prompt ?? null : null, promptSubmitted: player.prompt !== null, submitted: player.submitted, song: { ...structuredClone(player.song), ...(game.phase === 'music' && owner?.contributions.length ? { layers: structuredClone(owner.contributions.map(p => p.song)) } : {}) } } : null,
    revealHistory: game.phase === 'results' ? Array.from({ length: Math.max(game.revealed ?? 0, game.reveal.index) + 1 }, (_, index) => {
      const chainIndex = Math.floor(index / (rounds + 1))
      const contribution = index % (rounds + 1)
      const chain = game.players[chainIndex]
      const part = chain.contributions[contribution - 1]
      return { playerId: part?.playerId ?? chain.id, name: part?.name ?? chain.name, prompt: chain.prompt!, promptAuthor: chain.name, automatic: part?.automatic ?? false, chainIndex, contribution, contributionTotal: rounds, bpm: part?.song.bpm ?? DEFAULT_BPM }
    }) : [],
    results: game.phase === 'results' ? [{
      playerId: part?.playerId ?? chain.id, name: part?.name ?? chain.name,
      prompt: chain.prompt!, promptAuthor: chain.name,
      song: part ? structuredClone(ownPart(part.song)) : freshSong(),
      automatic: part?.automatic ?? false, chainIndex, contribution, contributionTotal: rounds,
    }] : [],
  }
}

export function controlReveal(game: Game, action: unknown, revision: unknown) {
  if (game.phase !== 'results') throw new Error('The reveal has not started yet.')
  if (revision !== game.reveal.revision) throw new Error('The reveal has moved on. Try again.')
  if (!['next', 'previous', 'play', 'stop'].includes(String(action))) throw new Error('Invalid reveal action.')
  const next = game.reveal.index + (action === 'next' ? 1 : action === 'previous' ? -1 : 0)
  if (next < 0 || next >= game.players.length * game.players.length) throw new Error('There are no more songs in that direction.')
  game.revealed = Math.max(game.revealed ?? 0, game.reveal.index, next)
  game.reveal = { index: next, playing: action === 'play', revision: game.reveal.revision + 1 }
}
