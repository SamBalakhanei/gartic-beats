import test from 'node:test'
import assert from 'node:assert/strict'
import { withVoice } from '../../server/test-voice.mjs'
import { emptyPattern } from '../music/pattern.ts'
import { manifest, hydrate, verifyAudio } from './audio.ts'
import { validateSong } from '../../server/game.ts'

const song = withVoice({ pattern: emptyPattern(), bpm: 120 })
test('references keep exact audio and mix while coordinator rejects raw audio', async () => {
  const cache = new Map()
  const input = { ...song, mix: { beat: .2, voice: .9 } }
  const reference = await manifest(input, (id, track) => cache.set(id, track))
  assert.match(reference.voice.data, /^p2p:[a-f0-9]{64}$/)
  assert.deepEqual(validateSong(reference, true), reference)
  assert.throws(() => validateSong(input, true), /reference/)
  assert.equal(hydrate(reference, () => undefined), null)
  assert.deepEqual(hydrate(reference, id => cache.get(id)), input)
  await verifyAudio(reference.voice.data, input.voice)
  await assert.rejects(verifyAudio('p2p:' + '0'.repeat(64), input.voice), /integrity/)
})
test('references reject malformed identifiers and tempo, and preserve multi-layer edits', async () => {
  for (const data of ['p2p:x', 'https://example.com/audio', song.voice.data]) {
    assert.throws(() => validateSong({ ...song, voice: { ...song.voice, data } }, true))
  }
  const clip = { id: 'take1', name: 'Take', voice: song.voice, bpm: 240, startStep: 3.25, trimStart: .2, trimEnd: 4, volume: .7 }
  const input = { pattern: song.pattern, bpm: 96, vocals: [clip], mix: { beat: .3, voice: 1 } }
  const cache = new Map()
  const wire = await manifest(input, (id, track) => cache.set(id, track))
  assert.deepEqual(hydrate(validateSong(wire, true), id => cache.get(id)), input)
})
