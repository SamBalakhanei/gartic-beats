import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame, submitPrompt, saveSong, gameView, validateSong, finishIfReady } from './game.ts'
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
  assert.equal(gameView(game, 'a', 700000).results.length, 2)
})
