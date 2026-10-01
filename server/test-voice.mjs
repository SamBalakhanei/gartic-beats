import { encodeVoice, VOICE_SAMPLE_RATE } from '../src/music/voice.ts'

// Synthetic tone fixture: never reads a physical microphone.
export function withVoice(song, recordedBpm = song.bpm) {
  const samples = new Float32Array(Math.round(960 / recordedBpm * VOICE_SAMPLE_RATE))
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 2 * Math.PI * 220 / VOICE_SAMPLE_RATE) * 0.1
  return { ...song, voice: { bpm: recordedBpm, data: Buffer.from(encodeVoice(samples)).toString('base64') } }
}
