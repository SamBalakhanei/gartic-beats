import test from 'node:test'
import assert from 'node:assert/strict'
import { createLobby, addPlayer, removePlayer, canStart, MAX_PLAYERS } from './lobby.ts'

test('a new lobby has its host and cannot start alone', () => {
  const lobby = createLobby()
  assert.equal(lobby.players.length, 1)
  assert.equal(lobby.players[0].id, lobby.hostId)
  assert.equal(canStart(lobby), false)
})

test('adding a second player enables start; removing them disables it again', () => {
  const original = createLobby()
  const joined = addPlayer(original, '  Sam  ', 'guest')
  assert.equal(joined.players[1].name, 'Sam')
  assert.equal(canStart(joined), true)
  assert.equal(canStart(removePlayer(joined, 'guest')), false)
  assert.equal(original.players.length, 1)
  assert.deepEqual(removePlayer(joined, joined.hostId), joined)
})

test('invalid guests, duplicate identities, and players above the cap are rejected', () => {
  let lobby = createLobby()
  for (const name of ['', '   ', 'a'.repeat(25)]) assert.equal(addPlayer(lobby, name, 'guest'), lobby)
  assert.equal(addPlayer(lobby, 'Another host', lobby.hostId), lobby)
  for (let i = 1; i < MAX_PLAYERS; i++) lobby = addPlayer(lobby, `Guest ${i}`, `${i}`)
  assert.equal(lobby.players.length, MAX_PLAYERS)
  assert.equal(addPlayer(lobby, 'Extra', 'extra'), lobby)
})
