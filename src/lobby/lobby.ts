import type { GameView } from '../game/types.ts'
export const MAX_PLAYERS = 8
export type Player = { id: string; name: string; connected: boolean; peerReady?: boolean }
export type Lobby = { id: string; players: Player[]; hostId: string; game?: GameView }
export type Session = { roomId: string; playerId: string; token: string }
export type ServerMessage =
  | { type: 'signal'; from: string; signal: unknown }
  | { type: 'joined'; room: Lobby; session: Session }
  | { type: 'room'; room: Lobby }
  | { type: 'left' }
  | { type: 'ack' }
  | { type: 'draft_saved'; revision: number }
  | { type: 'notice'; message: string }
  | { type: 'error'; code: string; message: string }

export function canStart(lobby: Lobby): boolean {
  const connected = lobby.players.filter(player => player.connected)
  return connected.length >= 2 && connected.every(player => player.peerReady !== false)
}
