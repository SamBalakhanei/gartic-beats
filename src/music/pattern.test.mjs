import test from 'node:test'
import assert from 'node:assert/strict'
import { BARS, TOTAL_STEPS, STEP_SECONDS, instruments, emptyPattern, toggleStep, clearBar, createPreset } from './pattern.ts'

test('every starter is a four-bar, eight-second loop with independent instrument tracks', () => {
  assert.equal(TOTAL_STEPS * STEP_SECONDS, 8)
  for (const preset of ['sneaky', 'dance', 'clumsy']) {
    const pattern = createPreset(preset)
    for (const { id } of instruments) {
      assert.equal(pattern[id].length, TOTAL_STEPS)
      for (let bar = 0; bar < BARS; bar++) assert.ok(pattern[id].slice(bar * 16, bar * 16 + 16).some(Boolean))
    }
    assert.notEqual(pattern.kick, pattern.snare)
  }
})

test('editing a later bar leaves prior snapshots and other bars intact for undo', () => {
  const original = emptyPattern()
  const edited = toggleStep(original, 'kick', 32)
  assert.equal(edited.kick[32], true)
  assert.equal(edited.kick[0], false)
  assert.equal(original.kick[32], false)
  assert.equal(edited.snare.some(Boolean), false)
  assert.deepEqual(toggleStep(edited, 'kick', 32), original)
})

test('clearing a bar preserves the other three bars and the original snapshot', () => {
  const original = createPreset('dance')
  const snapshot = structuredClone(original)
  const cleared = clearBar(original, 1)
  for (const { id } of instruments) {
    assert.equal(cleared[id].slice(16, 32).some(Boolean), false)
    assert.deepEqual(cleared[id].slice(0, 16), original[id].slice(0, 16))
    assert.deepEqual(cleared[id].slice(32), original[id].slice(32))
  }
  assert.deepEqual(original, snapshot)
})

test('loading or changing a preset never mutates another pattern', () => {
  const first = createPreset('dance')
  const second = createPreset('dance')
  first.kick.fill(false)
  assert.ok(second.kick.some(Boolean))
  const blank = emptyPattern()
  blank.kick[0] = true
  assert.equal(blank.snare[0], false)
})
