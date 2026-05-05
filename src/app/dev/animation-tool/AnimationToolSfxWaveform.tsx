"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { previewVolumePercentToAudioVolume } from "./animationToolPreviewVolume"

export type AnimationToolSfxWaveformProps = {
  /** Site-relative or absolute URL for the MP3 (include cache-bust query when needed). */
  readonly audioSrc: string | null
  /** Preview loudness 0–100 (does not affect game runtime). */
  readonly previewVolumePercent: number
}

const PEAK_BAR_COUNT = 400

/**
 * Decodes an MP3 URL into min/max peak samples for canvas rendering.
 *
 * @param audioSrc - URL to fetch and decode.
 * @returns Normalized peak magnitudes in `[0, 1]`, length `PEAK_BAR_COUNT`, or `null` on failure.
 */
export async function decodeMp3PeaksForWaveform(audioSrc: string): Promise<{
  readonly peaks: readonly number[]
  readonly durationSec: number
} | null> {
  try {
    const res = await fetch(audioSrc)
    if (!res.ok) return null
    const ab = await res.arrayBuffer()
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(ab.slice(0))
    await ctx.close().catch(() => {})
    const ch0 = buf.getChannelData(0)
    const samples = ch0.length
    const windowSize = Math.max(1, Math.floor(samples / PEAK_BAR_COUNT))
    const p: number[] = []
    for (let i = 0; i < PEAK_BAR_COUNT; i++) {
      let min = 1
      let max = -1
      const start = i * windowSize
      const end = Math.min(samples, start + windowSize)
      for (let j = start; j < end; j++) {
        const v = ch0[j]!
        if (v < min) min = v
        if (v > max) max = v
      }
      p.push(Math.max(Math.abs(min), Math.abs(max)))
    }
    return { peaks: p, durationSec: buf.duration }
  } catch {
    return null
  }
}

/**
 * Renders a clickable waveform preview: decode peaks from the MP3 URL, play on click,
 * show a playhead while audio plays, and block replay until `ended`.
 */
export function AnimationToolSfxWaveform(props: AnimationToolSfxWaveformProps) {
  const { audioSrc, previewVolumePercent } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const peaksRef = useRef<readonly number[] | null>(null)

  const [peaks, setPeaks] = useState<readonly number[] | null>(null)
  const [durationSec, setDurationSec] = useState(0)
  const [decodeBusy, setDecodeBusy] = useState(false)
  const [hover, setHover] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playheadSec, setPlayheadSec] = useState(0)
  const [, setRaf] = useState(0)

  useEffect(() => {
    peaksRef.current = peaks
  }, [peaks])

  const redraw = useCallback(() => {
    const c = canvasRef.current
    const wrap = wrapRef.current
    const peakData = peaksRef.current
    if (!c || !wrap || !peakData?.length) return
    const wCss = Math.max(1, wrap.clientWidth)
    const hCss = 44
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
    c.width = Math.max(1, Math.floor(wCss * dpr))
    c.height = Math.max(1, Math.floor(hCss * dpr))
    c.style.height = `${String(hCss)}px`
    const g = c.getContext("2d")
    if (!g) return
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.scale(dpr, dpr)
    g.clearRect(0, 0, wCss, hCss)
    g.fillStyle = "#0c0a09"
    g.fillRect(0, 0, wCss, hCss)
    const mid = hCss / 2
    const n = peakData.length
    const barW = wCss / n
    g.lineWidth = 1
    g.strokeStyle = hover ? "#bef264" : "#78716c"
    for (let i = 0; i < n; i++) {
      const amp = peakData[i]! * mid * 0.92
      const x = i * barW + barW / 2
      g.beginPath()
      g.moveTo(x, mid - amp)
      g.lineTo(x, mid + amp)
      g.stroke()
    }
    const dur = durationSec
    if (playing && dur > 0) {
      const x = (playheadSec / dur) * wCss
      g.strokeStyle = "#fafaf9"
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, hCss)
      g.stroke()
    }
  }, [durationSec, hover, playheadSec, playing])

  useEffect(() => {
    redraw()
  }, [redraw, peaks, audioSrc])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      redraw()
      setRaf((k) => k + 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [redraw])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const a = audioRef.current
      setPlayheadSec(a?.currentTime ?? 0)
      setRaf((k) => k + 1)
      redraw()
    }, 48)
    return () => window.clearInterval(id)
  }, [playing, redraw])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setPeaks(null)
      setDurationSec(0)
      setDecodeBusy(Boolean(audioSrc))
    })
    if (!audioSrc) {
      return () => {
        cancelled = true
      }
    }
    void (async () => {
      const decoded = await decodeMp3PeaksForWaveform(audioSrc)
      if (cancelled) return
      setDecodeBusy(false)
      if (decoded) {
        setPeaks(decoded.peaks)
        setDurationSec(decoded.durationSec)
      } else {
        setPeaks(null)
        setDurationSec(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [audioSrc])

  const stopPlayback = useCallback(() => {
    const a = audioRef.current
    if (a) {
      a.pause()
      a.src = ""
      audioRef.current = null
    }
    setPlaying(false)
    setPlayheadSec(0)
    setRaf((k) => k + 1)
  }, [])

  useEffect(() => {
    return () => {
      stopPlayback()
    }
  }, [audioSrc, stopPlayback])

  const startPlayback = useCallback(() => {
    if (!audioSrc || playing) return
    const a = new Audio(audioSrc)
    a.volume = previewVolumePercentToAudioVolume(previewVolumePercent)
    audioRef.current = a
    setPlaying(true)
    setPlayheadSec(0)
    setRaf((k) => k + 1)
    void a.play().catch(() => {
      setPlaying(false)
      audioRef.current = null
    })
    a.addEventListener("ended", () => {
      audioRef.current = null
      setPlaying(false)
      setPlayheadSec(0)
      setRaf((k) => k + 1)
    })
  }, [audioSrc, playing, previewVolumePercent])

  useEffect(() => {
    const a = audioRef.current
    if (a) a.volume = previewVolumePercentToAudioVolume(previewVolumePercent)
  }, [previewVolumePercent])

  if (!audioSrc) {
    return (
      <p className="mt-2 font-mono text-[11px] text-stone-500" data-testid="animation-tool-sfx-waveform-empty">
        No preview URL (missing SFX key).
      </p>
    )
  }

  return (
    <div className="mt-2" ref={wrapRef}>
      <button
        type="button"
        className={[
          "relative w-full overflow-hidden rounded-lg border text-left transition-colors",
          hover ? "border-lime-400 bg-lime-950/20" : "border-stone-600 bg-stone-900/90",
          playing ? "cursor-wait opacity-90" : "cursor-pointer hover:border-lime-600",
        ].join(" ")}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          if (playing) return
          void startPlayback()
        }}
        disabled={decodeBusy || !peaks?.length}
        aria-busy={playing}
        data-testid="animation-tool-sfx-waveform"
        aria-label={playing ? "SFX playing" : "Play SFX preview"}
      >
        <canvas ref={canvasRef} className="block h-11 w-full" />
      </button>
      {decodeBusy ? (
        <p className="mt-1 font-mono text-[10px] text-stone-500" data-testid="animation-tool-sfx-waveform-loading">
          Loading waveform…
        </p>
      ) : null}
    </div>
  )
}
