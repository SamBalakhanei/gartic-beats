import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeVoice, validateVoice, VOICE_SAMPLE_RATE, MAX_VOICE_BYTES } from './voice.ts'
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
  assert.throws(() => validateVoice({ ...voice, data: 'A'.repeat(Math.ceil(MAX_VOICE_BYTES / 3) * 4 + 4) }))
  assert.throws(() => validateVoice({ ...voice, bpm: 999 }))
  assert.throws(() => validateVoice({ ...voice, bpm: 60 }))
})


test('new takes retain 48 kHz detail and declare the correct PCM byte rate', () => {
  const rate = VOICE_SAMPLE_RATE
  assert.equal(rate, 48000)
  const samples = Float32Array.from({ length: rate * 4 }, (_, i) => Math.sin(i * 2 * Math.PI * 12000 / rate) * 0.5)
  const bytes = encodeVoice(samples)
  const header = new DataView(bytes.buffer)
  assert.equal(header.getUint32(24, true), 48000)
  assert.equal(header.getUint32(28, true), 96000)
  assert.equal(header.getUint16(34, true), 16)
  for (let i = 0; i < 100; i++) assert.ok(Math.abs(header.getInt16(44 + i * 2, true) / 32767 - samples[i]) < 1 / 32767)
  const track = { bpm: 240, data: Buffer.from(bytes).toString('base64') }
  assert.deepEqual(validateVoice(track), track)
})

test('legacy 16 kHz takes still validate while unsupported rates and bad byte rates fail', () => {
  const samples = Float32Array.from({ length: 16000 * 4 }, (_, i) => Math.sin(i * 0.1) * 0.1)
  const bytes = encodeVoice(samples)
  const header = new DataView(bytes.buffer)
  header.setUint32(24, 16000, true); header.setUint32(28, 32000, true)
  const track = { bpm: 240, data: Buffer.from(bytes).toString('base64') }
  assert.deepEqual(validateVoice(track), track)
  header.setUint32(28, 96000, true)
  assert.throws(() => validateVoice({ ...track, data: Buffer.from(bytes).toString('base64') }))
  header.setUint32(24, 8000, true); header.setUint32(28, 16000, true)
  assert.throws(() => validateVoice({ ...track, data: Buffer.from(bytes).toString('base64') }))
})
