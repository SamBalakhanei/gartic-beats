import { useEffect, useRef, useState } from 'react'
import { encodeVoice, validateVoice, VOICE_SAMPLE_RATE } from './voice'
import type { VoiceTrack } from './voice'

type Props = { bpm: number; disabled: boolean; targetName?: string; prepareBeat: () => Promise<void>; startBeat: () => Promise<number | undefined>; stopBeat: () => void; onTake: (voice: VoiceTrack) => void; onBusy: (busy: boolean) => void }

export default function VoiceRecorder(props: Props) {
  const current = useRef(props); current.current = props
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mounted = useRef(false)
  const generation = useRef(0)
  const busy = useRef(false)
  const [state, setState] = useState<'idle' | 'permission' | 'recording' | 'processing'>('idle')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(0)

  function stop() {
    clearTimeout(timer.current)
    if (recorder.current?.state === 'recording') recorder.current.stop()
    stream.current?.getTracks().forEach(track => track.stop())
    current.current.stopBeat()
  }
  function cancel() {
    // Disabling an idle recorder during playback must not stop the song.
    if (!busy.current) return
    busy.current = false
    generation.current++
    stop()
    if (mounted.current) { setState('idle'); current.current.onBusy(false) }
  }
  useEffect(() => {
    mounted.current = true
    const hide = () => { if (document.hidden && busy.current) { cancel(); setError('Recording cancelled when you left the tab. Your previous take is kept.') } }
    document.addEventListener('visibilitychange', hide)
    return () => { mounted.current = false; cancel(); document.removeEventListener('visibilitychange', hide) }
  }, [])
  useEffect(() => { if (props.disabled) cancel() }, [props.disabled])
  useEffect(() => {
    if (state !== 'recording') return
    const tick = setInterval(() => setElapsed(Math.max(0, (performance.now() - started.current) / 1000)), 100)
    return () => clearInterval(tick)
  }, [state])

  async function record() {
    if (props.disabled || state !== 'idle') return
    const version = ++generation.current
    const bpm = props.bpm
    const duration = 960 / bpm
    const valid = () => mounted.current && generation.current === version && !current.current.disabled
    busy.current = true
    setError(''); setState('permission'); props.onBusy(true); props.stopBeat()
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Microphone recording requires a supported browser on localhost or HTTPS.')
      await current.current.prepareBeat()
      if (!valid()) return
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false })
      if (!valid()) { media.getTracks().forEach(track => track.stop()); return }
      stream.current = media
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
      const take = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
      recorder.current = take
      const chunks: BlobPart[] = []
      let offset = 0
      let recordingStart = 0
      take.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      take.onerror = () => { cancel(); setError('Recording failed. Please try again.') }
      take.onstop = async () => {
        media.getTracks().forEach(track => track.stop())
        if (!valid()) return
        setState('processing')
        let context: AudioContext | undefined
        try {
          if (performance.now() - recordingStart < 500) throw new Error('Record at least half a second before stopping.')
          context = new AudioContext()
          const decoded = await context.decodeAudioData(await new Blob(chunks, { type: take.mimeType }).arrayBuffer())
          const samples = new Float32Array(Math.round(duration * VOICE_SAMPLE_RATE))
          const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i))
          for (let i = 0; i < samples.length; i++) {
            const position = (i / VOICE_SAMPLE_RATE + offset) * decoded.sampleRate
            const index = Math.floor(position), fraction = position - index
            if (index + 1 >= decoded.length) break
            samples[i] = channels.reduce((sum, channel) => sum + channel[index] * (1 - fraction) + channel[index + 1] * fraction, 0) / channels.length
          }
          const bytes = encodeVoice(samples)
          let binary = ''
          for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
          const voice = validateVoice({ data: btoa(binary), bpm })
          if (valid()) current.current.onTake(voice)
        } catch (cause) { if (valid()) setError(cause instanceof Error ? cause.message : 'Could not process this take.') }
        finally { await context?.close(); if (valid()) { busy.current = false; setState('idle'); current.current.onBusy(false) } }
      }
      take.onstart = async () => {
        if (!valid()) { media.getTracks().forEach(track => track.stop()); return }
        recordingStart = performance.now()
        try {
          const beatStart = await current.current.startBeat()
          if (!valid() || beatStart === undefined) { cancel(); return }
          offset = Math.max(0, (beatStart - recordingStart) / 1000)
          started.current = beatStart; setElapsed(0); setState('recording')
          timer.current = setTimeout(stop, Math.max(0, beatStart - performance.now()) + duration * 1000)
        } catch { cancel(); setError('Could not start the beat. Please try recording again.') }
      }
      take.start()
    } catch (cause) {
      if (valid()) {
        stop(); busy.current = false; setState('idle'); props.onBusy(false)
        setError(cause instanceof DOMException && cause.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser, then try again.' : cause instanceof Error ? cause.message : 'No microphone available.')
      }
    }
  }

  return <div className="record-module" aria-label="Voice recording">
    <div className="record-actions">
      {state === 'recording' ? <button className="record-button recording" onClick={stop}><span aria-hidden="true">■</span> Stop · {elapsed.toFixed(1)}s</button> : <button className="record-button" disabled={props.disabled || state !== 'idle'} onClick={() => void record()}><span aria-hidden="true">●</span> {state === 'permission' ? 'Allow microphone…' : state === 'processing' ? 'Preparing…' : props.targetName ? 'Replace take' : 'Record voice'}</button>}
      {state === 'permission' && <button className="text-button" onClick={cancel}>Cancel</button>}
    </div>
    <span className="record-hint" role="status">{state === 'recording' ? 'Microphone on · headphones recommended' : props.targetName ? `Replacing ${props.targetName}` : 'New layer · one loop · use headphones'}</span>
    {error && <p className="error" role="alert">{error}</p>}
  </div>
}
