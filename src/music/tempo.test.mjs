import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBpm, stepSeconds, StepClock } from './tempo.ts'

test('tempo clamps and rounds input, and invalid edits retain the prior tempo', () => {
  assert.equal(normalizeBpm(0), 40)
  assert.equal(normalizeBpm(999), 240)
  assert.equal(normalizeBpm(92.6), 93)
  assert.equal(normalizeBpm(NaN, 90), 90)
  assert.equal(normalizeBpm(Infinity, 100), 100)
  assert.equal(64 * stepSeconds(60), 16)
  assert.equal(64 * stepSeconds(120), 8)
  assert.equal(64 * stepSeconds(240), 4)
})

test('live tempo changes preserve queued notes and step order while changing future spacing', () => {
  const clock = new StepClock(0.04, 64)
  assert.deepEqual(clock.schedule(0, 120), [{ at: 0.04, step: 0 }])
  assert.equal(clock.position(0.03), -1)
  assert.equal(clock.position(0.04), 0)
  const next = clock.schedule(0.1, 60)
  assert.equal(next[0].step, 1)
  assert.ok(Math.abs(next[0].at - 0.165) < 1e-10)
  const slower = clock.schedule(0.35, 60)
  assert.equal(slower[0].step, 2)
  assert.ok(Math.abs(slower[0].at - next[0].at - 0.25) < 1e-10)
  assert.equal(clock.position(0.4), 1)
  assert.equal(clock.position(0.42), 2)
})

test('every supported tempo loops in order and audio timestamps drive the playhead', () => {
  for (const bpm of [40, 90, 120, 240]) {
    const clock = new StepClock(0.04, 64)
    const events = []
    for (let tick = 0; events.length < 130; tick++) {
      const now = tick * 0.025
      events.push(...clock.schedule(now, bpm))
      const audible = events.filter(event => event.at <= now).at(-1)
      assert.equal(clock.position(now), audible?.step ?? -1)
    }
    events.forEach((event, index) => {
      assert.equal(event.step, index % 64)
      if (index) assert.ok(Math.abs(event.at - events[index - 1].at - stepSeconds(bpm)) < 1e-9)
    })
  }
})

test('a stalled scheduler skips missed notes instead of emitting an overdue burst', () => {
  const clock = new StepClock(0, 64)
  clock.schedule(0, 120)
  const events = clock.schedule(2, 120)
  assert.ok(events.length > 0)
  assert.ok(events.every(event => event.at >= 2))
  assert.equal(events[0].step, 16)
})
