export const VOICE_SAMPLE_RATE = 48000
export const MAX_VOICE_BYTES = 44 + 24 * VOICE_SAMPLE_RATE * 2
export type VoiceTrack = { data: string; bpm: number }

// Canonical mono PCM WAV keeps recordings playable across browser codecs.
export function encodeVoice(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, VOICE_SAMPLE_RATE, true); view.setUint32(28, VOICE_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true))
  return bytes
}

export function voiceBytes(data: string): Uint8Array {
  return Uint8Array.from(atob(data), char => char.charCodeAt(0))
}

export function validateVoice(value: unknown): VoiceTrack {
  if (!value || typeof value !== 'object') throw new Error('Record a voice track before submitting.')
  const track = value as Partial<VoiceTrack>
  if (typeof track.bpm !== 'number' || !Number.isInteger(track.bpm) || track.bpm < 40 || track.bpm > 240 || typeof track.data !== 'string' || track.data.length > Math.ceil(MAX_VOICE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(track.data)) throw new Error('Invalid voice track. Record again.')
  let bytes: Uint8Array
  try { bytes = voiceBytes(track.data) } catch { throw new Error('Invalid voice recording.') }
  if (bytes.length < 44 || bytes.length > MAX_VOICE_BYTES) throw new Error('Voice recording is too large or incomplete.')
  const view = new DataView(bytes.buffer)
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length))
  // Accept older saved takes without upsampling or changing their audio.
  const sampleRate = view.getUint32(24, true)
  const expectedSamples = Math.round(960 / track.bpm * sampleRate)
  if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE' || text(12, 4) !== 'fmt ' || text(36, 4) !== 'data' ||
      view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 ||
      view.getUint16(22, true) !== 1 || ![16000, VOICE_SAMPLE_RATE].includes(sampleRate) || view.getUint32(28, true) !== sampleRate * 2 ||
      view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44 || bytes.length !== 44 + expectedSamples * 2) throw new Error('Voice recording must match one loop at its recorded BPM.')
  let energy = 0
  for (let i = 44; i < bytes.length; i += 2) energy += (view.getInt16(i, true) / 32768) ** 2
  if (energy / expectedSamples < 0.0000001) throw new Error('The recording is silent. Check your microphone and record again.')
  return { data: track.data, bpm: track.bpm }
}

// The coordinator accepts references only: audio never enters Cloudflare storage.
export function validateVoiceReference(value: unknown): VoiceTrack {
  const track = value as Partial<VoiceTrack> | null
  if (!track || typeof track.data !== 'string' || !/^p2p:[a-f0-9]{64}$/.test(track.data) || !Number.isInteger(track.bpm) || track.bpm! < 40 || track.bpm! > 240) throw new Error('Invalid peer recording reference.')
  return { data: track.data, bpm: track.bpm! }
}
