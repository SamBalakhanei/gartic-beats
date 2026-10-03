import type { Song } from '../game/types.ts'
import type { VoiceTrack } from '../music/voice.ts'
import { validateVoice, validateVoiceReference } from '../music/voice.ts'

export const isReference = (data: string) => /^p2p:[a-f0-9]{64}$/.test(data)
export async function audioId(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return 'p2p:' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export function tracks(song: Song): VoiceTrack[] { return [...(song.vocals?.map(clip => clip.voice) ?? (song.voice ? [song.voice] : [])), ...(song.layers ?? []).flatMap(tracks)] }
export function mapTracks(song: Song, map: (track: VoiceTrack) => VoiceTrack): Song {
  return { ...song, ...(song.layers ? { layers: song.layers.map(layer => mapTracks(layer, map)) } : {}), ...(song.vocals ? { vocals: song.vocals.map(clip => ({ ...clip, voice: map(clip.voice) })) } : {}), ...(song.voice ? { voice: map(song.voice) } : {}) }
}
export async function manifest(song: Song, store: (id: string, track: VoiceTrack) => void): Promise<Song> {
  const refs = new Map<string, VoiceTrack>()
  for (const track of tracks(song)) {
    if (isReference(track.data)) { validateVoiceReference(track); continue }
    const id = await audioId(track.data)
    store(id, track)
    refs.set(track.data, { data: id, bpm: track.bpm })
  }
  return mapTracks(song, track => refs.get(track.data) ?? track)
}
export function hydrate(song: Song, get: (id: string) => VoiceTrack | undefined): Song | null {
  if (tracks(song).some(track => isReference(track.data) && !get(track.data))) return null
  return mapTracks(song, track => isReference(track.data) ? { ...get(track.data)!, bpm: track.bpm } : track)
}
export async function verifyAudio(id: string, track: VoiceTrack) {
  validateVoice(track)
  if (await audioId(track.data) !== id) throw new Error('Recording integrity check failed.')
}
