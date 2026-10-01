import type { Song } from '../game/types.ts'
import type { VoiceTrack } from './voice.ts'
export const MAX_VOCAL_LAYERS = 4
export const MIN_SAMPLE_BPM = 20
export const MAX_SAMPLE_BPM = 480
export type Mix = { beat: number; voice: number }
export type VocalClip = { id: string; name: string; voice: VoiceTrack; bpm: number; startStep: number; volume: number; trimStart?: number; trimEnd?: number }
export const DEFAULT_MIX: Mix = { beat: 0.8, voice: 1 }

export function songVocals(song: Song): VocalClip[] {
  return song.vocals ?? (song.voice ? [{ id: 'legacy', name: 'Voice 1', voice: song.voice, bpm: song.bpm, startStep: 0, volume: 1 }] : [])
}

export function clipTiming(clip: VocalClip, beatBpm: number) {
  const loopSeconds = 960 / beatBpm
  const startSeconds = clip.startStep / 64 * loopSeconds
  const rate = clip.bpm / clip.voice.bpm
  const offset = clip.trimStart ?? 0
  const end = clip.trimEnd ?? 960 / clip.voice.bpm
  const duration = (end - offset) / rate
  return { rate, offset, startSeconds, duration, audibleSeconds: Math.min(duration, loopSeconds - startSeconds), widthPercent: Math.min(duration / loopSeconds * 100, 100 - clip.startStep / 64 * 100) }
}

export type ClipEdit = 'move' | 'left' | 'right'
// Trims are source-audio seconds, so changing sample BPM keeps the same words.
export function editClipGesture(clip: VocalClip, beatBpm: number, mode: ClipEdit, deltaSteps: number, snap: boolean): VocalClip {
  const secondsPerStep = 15 / beatBpm
  const timing = clipTiming(clip, beatBpm)
  const sourceLength = 960 / clip.voice.bpm
  const start = clip.trimStart ?? 0
  const end = clip.trimEnd ?? sourceLength
  const quantize = (step: number) => snap ? Math.round(step) : step
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  if (mode === 'move') return { ...clip, startStep: clamp(quantize(clip.startStep + deltaSteps), 0, 63) }
  if (mode === 'left') {
    const delta = clamp(quantize(clip.startStep + deltaSteps) - clip.startStep, Math.max(-clip.startStep, -start / timing.rate / secondsPerStep), Math.min(63 - clip.startStep, (end - start - 0.02) / timing.rate / secondsPerStep))
    return { ...clip, startStep: clip.startStep + delta, trimStart: clamp(start + delta * secondsPerStep * timing.rate, 0, end - 0.02) }
  }
  const visibleEnd = clip.startStep + timing.audibleSeconds / secondsPerStep
  const targetEnd = quantize(visibleEnd + deltaSteps)
  return { ...clip, trimEnd: clamp(start + (targetEnd - clip.startStep) * secondsPerStep * timing.rate, start + 0.02, Math.min(sourceLength, start + (64 - clip.startStep) * secondsPerStep * timing.rate)) }
}
