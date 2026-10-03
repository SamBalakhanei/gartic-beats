import test from 'node:test'
import assert from 'node:assert/strict'
import { canStart } from './lobby.ts'

test('start requires two connected players, not merely two reserved slots', () => {
  const player = { id: 'host', name: 'Host', connected: true }
  const room = { id: 'room', hostId: player.id, players: [player] }
  assert.equal(canStart(room), false)
  room.players.push({ id: 'guest', name: 'Guest', connected: false })
  assert.equal(canStart(room), false)
  room.players[1].connected = true
  assert.equal(canStart(room), true)
})

test('direct audio readiness gates start even with two connected players', () => {
  const lobby = { players: [{ connected: true, peerReady: true }, { connected: true, peerReady: false }] }
  assert.equal(canStart(lobby), false)
  lobby.players[1].peerReady = true
  assert.equal(canStart(lobby), true)
})
