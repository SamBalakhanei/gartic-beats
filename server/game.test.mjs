import { withVoice } from './test-voice.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { controlReveal, createGame, submitPrompt, saveSong, gameView, validateSong, finishIfReady, departGame } from './game.ts'
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


test('manual submission accepts an instrumental contribution and deadline retains unfinished parts', () => {
  const game = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  submitPrompt(game, 'a', 'First', 0); submitPrompt(game, 'b', 'Second', 0)
  const song = { bpm: 120, pattern: emptyPattern() }
  song.pattern.kick[0] = true
  saveSong(game, 'a', song, true, 100)
  finishIfReady(game, 600000)
  assert.equal(game.phase, 'results')
  assert.equal(game.players[1].contributions[0].automatic, false)
  assert.deepEqual(game.players[1].contributions[0].song, song)
  assert.equal(game.players[0].contributions[0].automatic, true)
})

test('tempo changes preserve the original take and its recording tempo through save and reveal', () => {
  const game = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }])
  submitPrompt(game, 'a', 'First', 0); submitPrompt(game, 'b', 'Second', 0)
  const original = withVoice({ bpm: 120, pattern: emptyPattern() })
  const changed = { ...original, bpm: 80 }
  saveSong(game, 'a', changed, true, 100)
  finishIfReady(game, 600000)
  for (let i = 0; i < 3; i++) controlReveal(game, 'next', i)
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
  controlReveal(game, 'next', 2)
  controlReveal(game, 'next', 3)
  assert.throws(() => controlReveal(game, 'next', 4))
  controlReveal(game, 'previous', 4)
  assert.equal(game.reveal.index, 2)
})


test('2–8 players rotate through every other chain once, with prompts hidden after round one', () => {
  for (let size = 2; size <= 8; size++) {
    const game = createGame(Array.from({ length: size }, (_, i) => ({ id: String(i), name: `Player ${i}` })))
    for (const p of game.players) submitPrompt(game, p.id, `SECRET ${p.id}`, 0)
    const visits = new Map(game.players.map(p => [p.id, new Set()]))
    for (let round = 1; round < size; round++) {
      for (const p of game.players) {
        assert.notEqual(p.owner, p.id)
        assert.ok(!visits.get(p.id).has(p.owner))
        visits.get(p.id).add(p.owner)
        const view = gameView(game, p.id, round)
        assert.equal(view.round, round)
        assert.equal(view.mine.song.layers?.length ?? 0, round - 1)
        assert.equal(view.results.length, 0)
        if (round > 1) assert.ok(!JSON.stringify(view).includes('SECRET'))
        const song = { pattern: emptyPattern(), bpm: 120 }
        song.pattern.kick[round] = true
        saveSong(game, p.id, song, true, round, false, round)
      }
    }
    assert.equal(game.phase, 'results')
    for (const chain of game.players) {
      assert.equal(chain.contributions.length, size - 1)
      assert.equal(new Set(chain.contributions.map(p => p.playerId)).size, size - 1)
      assert.ok(chain.contributions.every(p => p.playerId !== chain.id))
    }
    for (let i = 0; i < size * size; i++) {
      const view = gameView(game, '0', 100)
      assert.equal(view.results.length, 1)
      const result = view.results[0]
      assert.equal(result.chainIndex, Math.floor(i / size))
      assert.equal(result.contribution, i % size)
      assert.equal(result.song.layers, undefined)
      assert.equal(view.revealHistory.length, i + 1)
      assert.ok(view.revealHistory.every(entry => !('song' in entry)))
      if (i + 1 < size * size) controlReveal(game, 'next', game.reveal.revision)
    }
  }
})

test('round boundary rejects late writes and keeps backing parts immutable with their original tempo', () => {
  const game = createGame(['a','b','c'].map(id => ({ id, name: id })))
  for (const p of game.players) submitPrompt(game, p.id, p.id, 0, 100)
  const song = { bpm: 90, pattern: emptyPattern(), mix: { beat: .3, voice: .7 } }
  song.pattern.kick[0] = true
  for (const p of game.players) saveSong(game, p.id, song, false, 10, false, 1)
  assert.throws(() => saveSong(game, 'a', song, true, 100, false, 1), /ended/)
  assert.equal(game.round, 2)
  assert.equal(game.deadline, 200)
  const view = gameView(game, 'a', 101)
  view.mine.song.layers[0].pattern.kick[0] = false
  const own = { bpm: 90, pattern: emptyPattern(), layers: [{ bpm: 1 }] }
  saveSong(game, 'a', own, false, 101, false, 2)
  assert.equal(gameView(game, 'a', 101).mine.song.layers[0].pattern.kick[0], true)
  assert.deepEqual(gameView(game, 'a', 101).mine.song.layers[0].mix, song.mix)
  assert.throws(() => saveSong(game, 'a', { ...own, bpm: 91 }, false, 101, false, 2), /tempo/)
  finishIfReady(game, 200)
  assert.equal(game.phase, 'results')
  assert.ok(game.players.every(p => p.contributions.every(c => c.automatic)))
})

test('departed players keep their drafts and are automatically skipped in future rounds', () => {
  const game = createGame(['a','b','c','d'].map(id => ({ id, name: id })))
  departGame(game, 'a', 0, 100)
  for (const p of game.players.slice(1)) submitPrompt(game, p.id, p.id, 0, 100)
  const song = { bpm: 120, pattern: emptyPattern() }
  for (let round = 1; round <= 3; round++) {
    assert.equal(game.players[0].submitted, true)
    for (const p of game.players.slice(1)) saveSong(game, p.id, song, true, round, false, round)
  }
  assert.equal(game.phase, 'results')
  assert.ok(game.players.flatMap(p => p.contributions).filter(c => c.playerId === 'a').every(c => c.automatic))
})


test('reveal history grows without leaking future entries and survives backward navigation and reload', () => {
  const game = createGame(['a', 'b', 'c'].map(id => ({ id, name: id })))
  for (const p of game.players) submitPrompt(game, p.id, `Secret ${p.id}`, 0, 100)
  for (let round = 1; round <= 2; round++) {
    for (const p of game.players) {
      const song = { bpm: 120, pattern: emptyPattern() }
      song.pattern.kick[round] = true
      saveSong(game, p.id, song, true, round, false, round)
    }
  }
  let view = gameView(game, 'a', 200)
  assert.equal(view.revealHistory.length, 1)
  assert.equal(view.revealHistory[0].prompt, 'Secret a')
  assert.ok(!JSON.stringify(view.revealHistory).includes('Secret b'))
  controlReveal(game, 'next', 0)
  controlReveal(game, 'next', 1)
  view = gameView(game, 'a', 200)
  assert.deepEqual(view.revealHistory.map(entry => entry.contribution), [0, 1, 2])
  assert.equal(view.results[0].song.pattern.kick[1], false)
  assert.equal(view.results[0].song.pattern.kick[2], true)
  assert.equal(view.results[0].song.layers, undefined)
  const history = view.revealHistory
  controlReveal(game, 'previous', 2)
  const restored = JSON.parse(JSON.stringify(game))
  view = gameView(restored, 'b', 200)
  assert.deepEqual(view.revealHistory, history)
  assert.equal(view.results[0].contribution, 1)
  assert.equal(view.results[0].song.pattern.kick[1], true)
  assert.equal(view.results[0].song.pattern.kick[2], false)
})
