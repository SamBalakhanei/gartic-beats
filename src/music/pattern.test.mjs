import test from 'node:test'
import assert from 'node:assert/strict'
import { BARS, TOTAL_STEPS, STEP_SECONDS, instruments, emptyPattern, toggleStep, clearBar, createPreset } from './pattern.ts'

test('every starter is a four-bar, eight-second loop with independent instrument tracks', () => {
  assert.equal(TOTAL_STEPS * STEP_SECONDS, 8)
  for (const preset of ['soul', 'stadium', 'industrial']) {
    const pattern = createPreset(preset)
    for (const { id } of instruments) {
      assert.equal(pattern[id].length, TOTAL_STEPS)
      assert.ok(pattern[id].every(step => typeof step === 'boolean'))
    }
    for (let bar = 0; bar < BARS; bar++) {
      assert.ok(instruments.some(({ id }) => pattern[id].slice(bar * 16, bar * 16 + 16).some(Boolean)))
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
  const original = createPreset('stadium')
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
  const first = createPreset('stadium')
  const second = createPreset('stadium')
  first.kick.fill(false)
  assert.ok(second.kick.some(Boolean))
  const blank = emptyPattern()
  blank.kick[0] = true
  assert.equal(blank.snare[0], false)
})


test('all eight voices support independent editing and clearing without changing history', () => {
  assert.equal(instruments.length, 8)
  let pattern = emptyPattern()
  for (const { id } of instruments) {
    const previous = pattern
    pattern = toggleStep(pattern, id, 63)
    assert.equal(previous[id][63], false)
    assert.equal(pattern[id][63], true)
    for (const other of instruments) {
      if (other.id !== id) assert.deepEqual(pattern[other.id], previous[other.id])
    }
  }
  const cleared = clearBar(pattern, 3)
  for (const { id } of instruments) {
    assert.equal(cleared[id].some(Boolean), false)
    assert.equal(pattern[id][63], true)
  }
})

test('starter patterns collectively introduce every voice while leaving room for edits', () => {
  const starters = ['soul', 'stadium', 'industrial'].map(createPreset)
  for (const { id } of instruments) assert.ok(starters.some(pattern => pattern[id].some(Boolean)), id)
  for (const pattern of starters) assert.ok(instruments.some(({ id }) => !pattern[id].some(Boolean)))
})


test('each preset develops across four bars instead of repeating the same bar', () => {
  for (const preset of ['soul', 'stadium', 'industrial']) {
    const pattern = createPreset(preset)
    const bars = Array.from({ length: BARS }, (_, bar) =>
      JSON.stringify(instruments.map(({ id }) => pattern[id].slice(bar * 16, bar * 16 + 16))),
    )
    assert.equal(new Set(bars).size, BARS, preset)
  }
})
