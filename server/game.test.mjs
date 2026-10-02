import { withVoice } from './test-voice.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { controlReveal, createGame, submitPrompt, saveSong, gameView, validateSong, finishIfReady } from './game.ts'
import { emptyPattern } from '../src/music/pattern.ts'

test('random assignment never gives a player their own prompt and uses every prompt exactly once', () => {
  const assignments = new Set()
  for (let size = 2; size <= 8; size++) for (let trial = 0; trial < 40; trial++) {
    const players = Array.from({ length: size }, (_, index) => ({ id: `${index}`, name: `Player ${index}` }))
    const game = createGame(players)
    for (const player of players) submitPrompt(game, player.id, `Prompt ${player.id}`, 1000)
    assert.equal(game.deadline, 601000)
    const prompts = players.map(player => gameView(game, player.id, 1000).mine.prompt)
    assert.equal(new Set(prompts).size, size)
    players.forEach((player, index) => assert.notEqual(prompts[index], `Prompt ${player.id}`))
    if (size === 8) assignments.add(prompts.join(','))
  }
  assert.ok(assignments.size > 1)
})

test('prompt and song validation reject malformed input and do not mutate saved work', () => {
  const game = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  assert.throws(() => submitPrompt(game, 'a', ' ', 0))
  assert.throws(() => submitPrompt(game, 'a', 'x'.repeat(241), 0))
  submitPrompt(game, 'a', 'First', 0)
  assert.throws(() => submitPrompt(game, 'a', 'Changed', 0))
  assert.equal(gameView(game, 'b', 0).mine.prompt, null)
  submitPrompt(game, 'b', 'Second', 0)
  for (const song of [null, { bpm: 0, pattern: emptyPattern() }, { bpm: 120, pattern: {} }, { bpm: 120, pattern: { ...emptyPattern(), kick: [true] } }]) assert.throws(() => validateSong(song))
  const song = { bpm: 100, pattern: emptyPattern() }
  saveSong(game, 'a', song, false, 100)
  song.pattern.kick[0] = true
  assert.equal(gameView(game, 'a', 100).mine.song.pattern.kick[0], false)
  assert.throws(() => saveSong(game, 'intruder', song, true, 100))
  assert.throws(() => saveSong(game, 'a', song, true, 600000))
  assert.equal(game.phase, 'results')
  finishIfReady(game, 700000)
  assert.equal(gameView(game, 'a', 700000).results.length, 1)
})


test('manual submission requires a voice track while deadline fallback accepts beat-only drafts', () => {
  const game = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  submitPrompt(game, 'a', 'First', 0); submitPrompt(game, 'b', 'Second', 0)
  const song = { bpm: 120, pattern: emptyPattern() }
  saveSong(game, 'a', song, false, 100)
  assert.throws(() => saveSong(game, 'a', song, true, 100), /voice/)
  saveSong(game, 'a', withVoice(song), true, 100)
  finishIfReady(game, 600000)
  const results = gameView(game, 'a', 600000).results
  assert.ok(results[0].song.voice)
  controlReveal(game, 'next', 0)
  const second = gameView(game, 'a', 600000).results[0]
  assert.equal(second.song.voice, undefined)
  assert.equal(second.automatic, true)
})

test('tempo changes preserve the original take and its recording tempo through save and reveal', () => {
  const game = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  submitPrompt(game, 'a', 'First', 0); submitPrompt(game, 'b', 'Second', 0)
  const original = withVoice({ bpm: 120, pattern: emptyPattern() })
  const changed = { ...original, bpm: 80 }
  saveSong(game, 'a', changed, true, 100)
  finishIfReady(game, 600000)
  const result = gameView(game, 'a', 600000).results[0]
  assert.equal(result.song.bpm, 80)
  assert.equal(result.song.voice.bpm, 120)
  assert.equal(result.song.voice.data, original.voice.data)
})


test('reveal exposes one song, bounds navigation and rejects stale commands', () => {
  const game = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  assert.throws(() => controlReveal(game, 'next', 0), /not started/)
  submitPrompt(game, 'a', 'First', 0); submitPrompt(game, 'b', 'Second', 0)
  finishIfReady(game, 600000)
  assert.deepEqual(game.reveal, { index: 0, playing: false, revision: 0 })
  assert.deepEqual(gameView(game, 'a', 600000).results.map(r => r.playerId), ['a'])
  assert.throws(() => controlReveal(game, 'previous', 0))
  assert.throws(() => controlReveal(game, 'jump', 0))
  controlReveal(game, 'play', 0)
  assert.equal(game.reveal.playing, true)
  assert.throws(() => controlReveal(game, 'next', 0), /moved on/)
  controlReveal(game, 'next', 1)
  assert.deepEqual(game.reveal, { index: 1, playing: false, revision: 2 })
  assert.deepEqual(gameView(game, 'a', 600000).results.map(r => r.playerId), ['b'])
  assert.throws(() => controlReveal(game, 'next', 2))
  controlReveal(game, 'previous', 2)
  assert.equal(game.reveal.index, 0)
})
