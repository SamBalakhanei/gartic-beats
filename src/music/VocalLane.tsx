import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { clipTiming, editClipGesture } from './arrangement'
import type { ClipEdit, VocalClip } from './arrangement'
import { voiceBytes } from './voice'

type Props = { clip: VocalClip; index: number; beatBpm: number; selected: boolean; step: number; disabled: boolean; snap: boolean; onSelect: () => void; onEdit: (patch: VocalClip) => void }

export default function VocalLane({ clip, index, beatBpm, selected, step, disabled, snap, onSelect, onEdit }: Props) {
  const surface = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ mode: ClipEdit; x: number; width: number; original: VocalClip; next: VocalClip; pointer: number; scroll: number } | null>(null)
  const [preview, setPreview] = useState<VocalClip | null>(null)
  const shown = preview ?? clip
  const timing = clipTiming(shown, beatBpm)
  const cancel = () => { gesture.current = null; setPreview(null) }
  useEffect(() => { cancel() }, [disabled, clip, beatBpm])
  const waveform = useMemo(() => {
    const bytes = voiceBytes(clip.voice.data)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = (bytes.length - 44) / 2
    return Array.from({ length: 160 }, (_, bin) => {
      let peak = 0
      for (let i = Math.floor(bin * count / 160); i < Math.min(count, (bin + 1) * count / 160); i += 8) peak = Math.max(peak, Math.abs(view.getInt16(44 + i * 2, true)) / 32768)
      return Math.max(3, Math.min(100, peak * 250))
    })
  }, [clip.voice.data])
  function begin(event: PointerEvent<HTMLButtonElement>, mode: ClipEdit) {
    if (disabled || event.button !== 0 || gesture.current) return
    event.preventDefault(); onSelect(); event.currentTarget.focus()
    const width = surface.current!.getBoundingClientRect().width
    gesture.current = { mode, x: event.clientX, width, original: clip, next: clip, pointer: event.pointerId, scroll: surface.current!.closest('.timeline-scroll')!.scrollLeft }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPreview(clip)
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const drag = gesture.current
    if (!drag || drag.pointer !== event.pointerId || disabled) return
    const scroll = surface.current!.closest('.timeline-scroll')!.scrollLeft
    const delta = (event.clientX - drag.x + scroll - drag.scroll) / drag.width * 64
    drag.next = editClipGesture(drag.original, beatBpm, drag.mode, delta, snap && !event.shiftKey)
    setPreview(drag.next)
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    const drag = gesture.current
    if (!drag || drag.pointer !== event.pointerId) return
    if (!disabled && (drag.next.startStep !== clip.startStep || drag.next.trimStart !== clip.trimStart || drag.next.trimEnd !== clip.trimEnd)) onEdit(drag.next)
    cancel()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, mode: ClipEdit) {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return }
    if (disabled || gesture.current || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault(); onSelect()
    onEdit(editClipGesture(clip, beatBpm, mode, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey || !snap ? 0.1 : 1), snap && !event.shiftKey))
  }
  const handlers = (mode: ClipEdit) => ({
    disabled, onPointerDown: (event: PointerEvent<HTMLButtonElement>) => begin(event, mode), onPointerMove: move, onPointerUp: finish,
    onPointerCancel: cancel, onLostPointerCapture: cancel, onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => key(event, mode), onClick: onSelect,
  })
  const sourceDuration = 960 / clip.voice.bpm
  const visibleSource = timing.audibleSeconds * timing.rate
  return <div className={`timeline-lane vocal-lane ${selected ? 'selected' : ''} ${preview ? 'is-editing' : ''}`} style={{ '--vocal-color': ['#bba4ff', '#82dfed', '#ffad73', '#ff96b1'][index] } as CSSProperties}>
    <button disabled={disabled} className="lane-label" aria-pressed={selected} onClick={onSelect}><strong>{clip.name}</strong><small>{clip.bpm} BPM · {Math.round(clip.volume * 100)}%</small></button>
    <div ref={surface} className="lane-surface">
      <div className="editable-region" style={{ left: `${shown.startStep / 64 * 100}%`, width: `${timing.widthPercent}%` }}>
        <button {...handlers('move')} className="clip-body" aria-label={`Move ${clip.name}`} title="Drag to move · Arrow keys to nudge · Shift for fine placement">
          <span className="waveform" aria-hidden="true" style={{ width: `${sourceDuration / visibleSource * 100}%`, left: `${-timing.offset / visibleSource * 100}%` }}>{waveform.map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</span>
          <span className="clip-caption">{clip.name}</span>
        </button>
        <button {...handlers('left')} className="trim-handle trim-left" aria-label={`Trim start of ${clip.name}`} title="Drag to trim start · Arrow keys to adjust"><span /></button>
        <button {...handlers('right')} className="trim-handle trim-right" aria-label={`Trim end of ${clip.name}`} title="Drag to trim end · Arrow keys to adjust"><span /></button>
      </div>
      {step >= 0 && <span className="timeline-playhead" style={{ left: `${step / 64 * 100}%` }} />}
    </div>
    {preview && <output className="clip-edit-readout" aria-live="off">Start {timing.startSeconds.toFixed(2)}s · Length {timing.audibleSeconds.toFixed(2)}s</output>}
  </div>
}
