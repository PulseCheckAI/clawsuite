/**
 * MotherboardBackdrop — a transparent, living circuit-board plane that sits
 * BEHIND the Octogent reactor constellation (engine-floor-live).
 *
 * Intent: "state-of-the-art autonomous AI" ambience — PCB traces, vias and IC
 * chips etched faintly into the navy void, with energy that flows continuously
 * along a subset of traces (the machine is "thinking"). Fully transparent: it
 * floats on the Mission-Control HUD and never paints a solid background.
 *
 * Game-art principles applied:
 *  - Staging / hierarchy: a radial focal vignette darkens the rim so the central
 *    reactor core stays the hero; base traces are faint, only "live" rails glow.
 *  - Silhouette readability: everything is low-opacity so foreground pucks/nodes
 *    keep clean silhouettes against it.
 *  - Restraint: motion is slow + sparse (current flow + gentle via breathing).
 *
 * Integrity:
 *  - SSR-safe: ALL geometry comes from a FIXED-seed PRNG (mulberry32) inside a
 *    useMemo, so server and client render identical SVG (no hydration mismatch).
 *    No Math.random / Date.now at render time.
 *  - pointer-events:none + zIndex:-1 → never intercepts clicks, always behind.
 *  - Honors prefers-reduced-motion (all animation disabled).
 *  - Pure presentation: imports nothing from the data layer.
 */
import { useMemo } from 'react'

const CYAN = '#00E5FF'
const EMERALD = '#3DF5A1'
const MAGENTA = '#FF4FD8'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const VB_W = 1200
const VB_H = 800
const GRID = 40

type Trace = {
  d: string
  len: number
  live: boolean
  color: string
  delay: number
}
type Pad = { x: number; y: number; r: number; delay: number }
type Chip = { x: number; y: number; w: number; h: number; pins: number }

function buildCircuit() {
  const rnd = mulberry32(0x9e3779b1) // fixed seed → deterministic across SSR/client
  const snap = (v: number) => Math.round(v / GRID) * GRID
  const clampW = (v: number) => Math.max(0, Math.min(VB_W, v))
  const clampH = (v: number) => Math.max(0, Math.min(VB_H, v))
  const traces: Trace[] = []
  const pads: Pad[] = []

  for (let i = 0; i < 46; i++) {
    let x = snap(rnd() * VB_W)
    let y = snap(rnd() * VB_H)
    let d = `M ${x} ${y}`
    let len = 0
    const segs = 2 + Math.floor(rnd() * 4)
    for (let s = 0; s < segs; s++) {
      const step = (1 + Math.floor(rnd() * 4)) * GRID * (rnd() > 0.5 ? 1 : -1)
      if (rnd() > 0.72) {
        const dd = (1 + Math.floor(rnd() * 2)) * GRID * (rnd() > 0.5 ? 1 : -1)
        x = clampW(x + dd)
        y = clampH(y + dd)
      } else if (rnd() > 0.5) {
        x = clampW(x + step)
      } else {
        y = clampH(y + step)
      }
      d += ` L ${x} ${y}`
      len += Math.abs(step)
    }
    const live = rnd() > 0.62
    const color = live && rnd() > 0.8 ? (rnd() > 0.5 ? EMERALD : MAGENTA) : CYAN
    traces.push({ d, len: Math.max(len, GRID), live, color, delay: rnd() * 6 })
    pads.push({ x, y, r: rnd() > 0.7 ? 4 : 2.5, delay: rnd() * 4 })
  }
  for (let i = 0; i < 26; i++) {
    pads.push({
      x: snap(rnd() * VB_W),
      y: snap(rnd() * VB_H),
      r: rnd() > 0.85 ? 3.5 : 2,
      delay: rnd() * 5,
    })
  }

  const chips: Chip[] = [
    { x: 80, y: 120, w: 150, h: 90, pins: 7 },
    { x: VB_W - 250, y: 150, w: 170, h: 70, pins: 8 },
    { x: 120, y: VB_H - 200, w: 120, h: 120, pins: 6 },
    { x: VB_W - 230, y: VB_H - 170, w: 160, h: 80, pins: 7 },
  ]
  return { traces, pads, chips }
}

export function MotherboardBackdrop() {
  const { traces, pads, chips } = useMemo(buildCircuit, [])
  const cols = VB_W / GRID + 1
  const rows = VB_H / GRID + 1

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes mb-flow { to { stroke-dashoffset: -1000; } }
        @keyframes mb-pad  { 0%,100%{opacity:.25} 50%{opacity:.9} }
        @keyframes mb-breathe { 0%,100%{opacity:.45} 50%{opacity:.8} }
        @media (prefers-reduced-motion: reduce){ .mb-anim{animation:none!important} }
      `}</style>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ display: 'block' }}
      >
        <defs>
          <radialGradient id="mb-focus" cx="50%" cy="58%" r="75%">
            <stop offset="0%" stopColor="#000" stopOpacity="0" />
            <stop offset="78%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#040910" stopOpacity="0.6" />
          </radialGradient>
          <filter id="mb-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* solder grid */}
        <g opacity="0.05" fill={CYAN}>
          {Array.from({ length: cols * rows }).map((_, i) => (
            <circle
              key={i}
              cx={(i % cols) * GRID}
              cy={Math.floor(i / cols) * GRID}
              r={0.8}
            />
          ))}
        </g>

        {/* etched base traces */}
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {traces.map((t, i) => (
            <path
              key={`b${i}`}
              d={t.d}
              stroke={t.color}
              strokeWidth={1}
              opacity={0.12}
            />
          ))}
        </g>

        {/* live energy pulses */}
        <g
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#mb-glow)"
        >
          {traces
            .filter((t) => t.live)
            .map((t, i) => (
              <path
                key={`l${i}`}
                className="mb-anim"
                d={t.d}
                stroke={t.color}
                strokeWidth={1.6}
                strokeDasharray={`28 ${Math.max(t.len, 160)}`}
                style={{
                  animation: `mb-flow ${7 + (t.delay % 5)}s linear ${t.delay}s infinite`,
                  filter: `drop-shadow(0 0 4px ${t.color})`,
                }}
              />
            ))}
        </g>

        {/* vias / pads */}
        <g>
          {pads.map((p, i) => (
            <g key={`p${i}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r + 1.5}
                fill="none"
                stroke={CYAN}
                strokeWidth={0.75}
                opacity={0.18}
              />
              <circle
                className="mb-anim"
                cx={p.x}
                cy={p.y}
                r={p.r}
                fill={CYAN}
                style={{
                  animation: `mb-pad ${4 + (p.delay % 3)}s ease-in-out ${p.delay}s infinite`,
                }}
              />
            </g>
          ))}
        </g>

        {/* IC chips at the rim */}
        <g
          className="mb-anim"
          style={{ animation: 'mb-breathe 9s ease-in-out infinite' }}
        >
          {chips.map((c, i) => (
            <g key={`c${i}`}>
              <rect
                x={c.x}
                y={c.y}
                width={c.w}
                height={c.h}
                rx={6}
                fill="rgba(0,229,255,0.03)"
                stroke={CYAN}
                strokeWidth={1}
                opacity={0.3}
              />
              {Array.from({ length: c.pins }).map((_, p) => {
                const px = c.x + ((p + 1) * c.w) / (c.pins + 1)
                return (
                  <g key={p} stroke={CYAN} strokeWidth={1} opacity={0.28}>
                    <line x1={px} y1={c.y} x2={px} y2={c.y - 7} />
                    <line x1={px} y1={c.y + c.h} x2={px} y2={c.y + c.h + 7} />
                  </g>
                )
              })}
              <circle
                cx={c.x + 12}
                cy={c.y + 12}
                r={3}
                fill="none"
                stroke={CYAN}
                strokeWidth={1}
                opacity={0.4}
              />
            </g>
          ))}
        </g>

        <rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#mb-focus)" />
      </svg>
    </div>
  )
}

export default MotherboardBackdrop
