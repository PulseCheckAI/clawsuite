# Voice Hub Components

PulseOS Voice Agent Hub UI primitives. All visual; data is stubbed inline
until Phase 1 backend (S1 schema, S2 voice-engine HTTP API, S3 caller-id
resolver) lands.

## Quick start

Visit `http://localhost:3010/voice-preview` to see everything mounted with
mock data. `/voice` is the production-shaped route; both use the same
components.

## Files

| File                      | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `LiquidGlassPanel.tsx`    | Base glassmorphism surface · `as` + `glow` + `interactive` props |
| `DialerKeypad.tsx`        | iPhone-style 3×4 keypad with E.164 normalization + call button   |
| `DialerKeypad.module.css` | Local styles for the keypad (cursor-refraction, button shadows)  |
| `HubOverview.tsx`         | The full `/voice` landing page (header + cards + queue + DNA)    |
| `PlaceCallSheet.tsx`      | Right-side slide-in modal for placing an outbound call           |
| `VoiceFloatingButton.tsx` | Bottom-right FAB that opens a dialer popover (gates by pathname) |

Tokens live in `src/styles/voice-hub-tokens.css` (scoped under
`[data-voice-hub]`) and are re-exported from `src/styles/voice-tokens.css`.
Every voice-hub component sets `data-voice-hub` somewhere on its root tree,
so `var(--vh-*)` resolves without leaking to other routes.

## Component APIs

### `LiquidGlassPanel`

```tsx
<LiquidGlassPanel
  as="article" // 'div' | 'section' | 'article' | 'aside' | 'header'
  glow="active" // 'active' | 'compliant' | 'blocked' | 'none'
  interactive={false} // adds hover lift + cursor-pointer
  density="comfortable" // 'comfortable' | 'compact'
  aria-label="…"
>
  …
</LiquidGlassPanel>
```

### `DialerKeypad`

```tsx
<DialerKeypad
  initialValue="" // optional pre-fill (raw digits)
  onChange={(buf) => …} // fires on every buffer change
  onCall={async ({ to }) => …} // override stub; receive E.164 string
  disabled={false}
/>
```

Stub `onCall` defaults log to `console.log('[voice-hub] POST /api/calls/place …')`.

### `PlaceCallSheet`

```tsx
<PlaceCallSheet
  open={open}
  onClose={() => setOpen(false)}
  initialTo="+1 (305) 555-0143" // optional, matches a stubbed lead
  initialScenario="q-check" // 'q-check' | 're-engage' | 'ad-hoc'
  onPlaceCall={async (payload) => …} // see PlaceCallPayload below
  onSaveScenario={async (payload) => …}
/>
```

`PlaceCallPayload`:

```ts
{
  to: string // E.164
  fromCallerId: string // caller-id phone number
  scenario: 'q-check' | 're-engage' | 'ad-hoc'
  customize: {
    expectedPain: string
    mustMention: string
    mustAvoid: string
    voice: 'warm' | 'professional' | 'energetic'
    maxDurationMin: number
  }
}
```

### `VoiceFloatingButton`

```tsx
<VoiceFloatingButton forceShow={false} />
```

Mounted globally in `src/routes/__root.tsx`. Self-gates: only renders when
`pathname` matches `/^\/voice(\/|-|$)/i`. Pass `forceShow` to bypass the
gate (used in `/voice-preview`).

Interactions:

- Left-click → toggles dialer popover above the FAB.
- Right-click → opens full `PlaceCallSheet`.
- Click-outside or Escape → closes the popover.

## Design system rules applied

- **`ui-ux-pro-max`** — 44 × 44 px hit areas, `cursor: pointer` on every
  clickable, focus rings via `[data-voice-hub] :focus-visible`, ARIA labels,
  16 px minimum body text, ≥4.5:1 contrast, escape-to-close, body scroll
  lock when modal open.
- **`antigravity-design-expert`** — glassmorphism (`backdrop-filter: blur
40px saturate 180%`), two-layer drop shadows, weightless entrance via
  spring physics, inset top-edge rim highlight, isometric tilt on hover,
  z-axis depth via `perspective: 1000` on hub cards.
- **`framer-motion`** — `motion/react` (Framer Motion v12), staggered card
  entrances (0.1 s between), `whileTap={{ scale: 0.95 }}` on every press,
  `AnimatePresence` for sheet enter/exit, spring transitions, transforms +
  opacity only (no animated `box-shadow` or layout). `prefers-reduced-motion`
  honored globally via `[data-voice-hub] *` CSS rule.

## Wiring to real data (post-Phase 1)

Once S1 / S2 / S3 ship:

1. **Queue + KPIs** (`HubOverview.tsx`)
   Replace the `QUEUE_STUB` / `COMPLIANCE_BREAKDOWN` / `AGENT_DNA_STUB`
   consts with `useQuery` calls against the new voice-engine endpoints
   (e.g. `GET /api/voice/queue`, `GET /api/voice/kpis/today`). Keep the
   stub fallback for `/voice-preview` — wrap the hook with a prop or env
   flag (`PUBLIC_VOICE_USE_STUBS=1`).

2. **Lead picker** (`PlaceCallSheet.tsx`)
   Swap `LEADS_STUB` for `useQuery(['voice', 'leads'], fetchLeads)`. The
   shape `{ id, name, phone }` already matches the silver-tier
   `dim_prospects.preferred_contact_phone` field; rename in the hook.

3. **Caller-IDs** (`PlaceCallSheet.tsx`)
   Replace `CALLER_IDS_STUB` with the org-scoped caller-id list S3 ships
   (`GET /api/voice/caller-ids` — auto-filtered by RLS).

4. **Compliance preflight** (`PlaceCallSheet.tsx`)
   Each row currently hard-codes `state: 'pass'`. Wire to the existing
   compliance subsystem the voice-engine already has (TCPA + DNC + window
   - rate-cap). Recommended shape: `POST /api/voice/preflight` with
     `{ leadId, callerId, scenario }` → returns the same 4-light array.

5. **Behavioral DNA** (`PlaceCallSheet.tsx`, `HubOverview.tsx`)
   Replace `BEHAVIORAL_DNA_STUB` / `AGENT_DNA_STUB` with a call to the
   `relationship-memory-mcp` `behavioral_dna` tool (already shipped in
   the voice-engine Slice 1 — see memory entry
   `project_voice_agent_behavioral_dna_2026-05-23`).

6. **Place call submission** (`DialerKeypad.tsx`, `PlaceCallSheet.tsx`)
   Both components accept `onCall` / `onPlaceCall` callbacks; override at
   the route level to POST to the voice-engine HTTP API. Expected shape
   matches the existing `pulseos-voice-engine` `/api/calls` contract.

7. **Live waveform** (`HubOverview.tsx`)
   Right now a pure CSS stub. Replace with a `useEffect` subscription to
   the voice-engine WebSocket prosody stream; map amplitude samples to
   `transform: scaleY(…)` on the `.vh-wave-bar` elements (currently driven
   by CSS keyframes).

## What's deliberately out of scope

- **Shadow Mode controls** (listen-only mute) — Phase 2.
- **AI Customizer chat** (in-sheet conversational scenario builder) —
  Phase 3.
- **Real-time call transcript pane** — Phase 2, when the engine starts
  emitting Deepgram partials over WS.
- **Per-call recording playback** — Phase 2.

Everything you see in `/voice-preview` is intentionally complete enough
to validate the visual + interaction story without any of the above.
