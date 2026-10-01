import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeVoice, validateVoice, VOICE_SAMPLE_RATE } from './voice.ts'
import { withVoice } from '../../server/test-voice.mjs'

test('valid voice takes cover one complete loop at every tempo extreme', () => {
  for (const bpm of [40, 93, 120, 240]) {
    const { voice } = withVoice({ bpm })
    assert.deepEqual(validateVoice(voice), voice)
  }
})

test('voice validation rejects silence, malformed headers, invalid base64 and oversized recordings', () => {
  const silent = encodeVoice(new Float32Array(8 * VOICE_SAMPLE_RATE))
  assert.throws(() => validateVoice({ bpm: 120, data: Buffer.from(silent).toString('base64') }), /silent/)
  const { voice } = withVoice({ bpm: 120 })
  const broken = Buffer.from(voice.data, 'base64'); broken[0] = 0
  assert.throws(() => validateVoice({ ...voice, data: broken.toString('base64') }))
  assert.throws(() => validateVoice({ ...voice, data: '!!!' }))
  assert.throws(() => validateVoice({ ...voice, data: 'A'.repeat(1100000) }))
  assert.throws(() => validateVoice({ ...voice, bpm: 999 }))
  assert.throws(() => validateVoice({ ...voice, bpm: 60 }))
})
