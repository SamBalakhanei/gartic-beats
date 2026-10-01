export type Player = { id: string; name: string }
export type Lobby = { players: Player[]; hostId: string }
export const MAX_PLAYERS = 8

export function createLobby(): Lobby {
  return { hostId: 'host', players: [{ id: 'host', name: 'You' }] }
}

export function canStart(lobby: Lobby): boolean {
  return lobby.players.length >= 2
}

export function addPlayer(lobby: Lobby, name: string, id: string): Lobby {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 24 || lobby.players.length >= MAX_PLAYERS || lobby.players.some(player => player.id === id)) return lobby
  return { ...lobby, players: [...lobby.players, { id, name: trimmed }] }
}

export function removePlayer(lobby: Lobby, id: string): Lobby {
  if (id === lobby.hostId) return lobby
  return { ...lobby, players: lobby.players.filter(player => player.id !== id) }
}
