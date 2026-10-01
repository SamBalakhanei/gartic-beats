import test from 'node:test'
import assert from 'node:assert/strict'
import { instruments } from './pattern.ts'
import { synthesizeDrum } from './sounds.ts'

for (const rate of [44100, 48000]) {
  test(`all eight voices produce finite, audible-level samples with clean boundaries at ${rate} Hz`, () => {
    for (const { id } of instruments) {
      const samples = synthesizeDrum(id, rate)
      assert.ok(samples.length >= rate * 0.05 && samples.length <= rate * 0.5, id)
      let peak = 0
      let energy = 0
      for (const value of samples) {
        assert.ok(Number.isFinite(value), `${id}: non-finite sample`)
        peak = Math.max(peak, Math.abs(value))
        energy += value * value
      }
      assert.ok(peak > 0.05 && peak <= 1, `${id}: unexpected peak ${peak}`)
      assert.ok(energy / samples.length > 0.0001, `${id}: nearly silent`)
      assert.equal(Math.abs(samples[0]), 0)
      assert.equal(Math.abs(samples.at(-1)), 0)
    }
  })
}

test('open hi-hat rings substantially longer than the closed hi-hat', () => {
  const closed = synthesizeDrum('hat', 48000)
  const open = synthesizeDrum('openHat', 48000)
  assert.ok(open.length > closed.length * 3)
  const tail = open.slice(closed.length)
  assert.ok(tail.some(value => Math.abs(value) > 0.01))
})
