/**
 * Per-agent autonomy mode store. Three modes:
 *
 *   off       — agent will not act on its own; explicit human invocation only
 *   approval  — agent will propose actions but require human confirmation
 *   auto      — fully autonomous; agent acts without confirmation
 *
 * Persisted to localStorage so it survives reloads. Tied to a stable agent
 * id (Octogent terminal id, Gateway session id, cron job id, helper persona
 * id). A global default applies to any agent without an override.
 *
 * Backend persistence (push to Supabase per dashboard user) is a Phase 4C
 * follow-up; for now this is per-browser. The external-store pattern keeps
 * subscriptions cheap and cross-component-consistent.
 */
import { useSyncExternalStore, useCallback } from 'react'

export type AutonomyMode = 'off' | 'approval' | 'auto'

const STORAGE_KEY = 'pulseos-agent-autonomy-v1'
const DEFAULT_MODE: AutonomyMode = 'approval'

type AutonomyStore = {
  overrides: Record<string, AutonomyMode>
  globalDefault: AutonomyMode
}

function isMode(value: unknown): value is AutonomyMode {
  return value === 'off' || value === 'approval' || value === 'auto'
}

function readStore(): AutonomyStore {
  if (typeof window === 'undefined') {
    return { overrides: {}, globalDefault: DEFAULT_MODE }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { overrides: {}, globalDefault: DEFAULT_MODE }
    const parsed = JSON.parse(raw) as Partial<AutonomyStore>
    return {
      overrides:
        typeof parsed.overrides === 'object' && parsed.overrides !== null
          ? (parsed.overrides as Record<string, AutonomyMode>)
          : {},
      globalDefault: isMode(parsed.globalDefault)
        ? parsed.globalDefault
        : DEFAULT_MODE,
    }
  } catch {
    return { overrides: {}, globalDefault: DEFAULT_MODE }
  }
}

function writeStore(next: AutonomyStore) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // localStorage may be full or disabled; degrade silently
  }
}

// ── External store + subscribers ────────────────────────────────────────────
const listeners = new Set<() => void>()
let cache: AutonomyStore | null = null

function getSnapshot(): AutonomyStore {
  if (cache === null) cache = readStore()
  return cache
}

function emit() {
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  const onStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY) {
      cache = readStore()
      emit()
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(fn)
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage)
    }
  }
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k])
      return false
  }
  return true
}

function commit(mutator: (s: AutonomyStore) => AutonomyStore) {
  const current = getSnapshot()
  const next = mutator(current)
  if (
    next === current ||
    (next.globalDefault === current.globalDefault &&
      shallowEqual(next.overrides, current.overrides))
  ) {
    return
  }
  cache = next
  writeStore(next)
  emit()
}

// ── Public API ──────────────────────────────────────────────────────────────
export function useGlobalAutonomy(): {
  mode: AutonomyMode
  setMode: (m: AutonomyMode) => void
} {
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setMode = useCallback((m: AutonomyMode) => {
    commit((s) => ({ ...s, globalDefault: m }))
  }, [])
  return { mode: store.globalDefault, setMode }
}

export function useAgentAutonomy(agentId: string): {
  mode: AutonomyMode
  effective: AutonomyMode
  isOverride: boolean
  setMode: (m: AutonomyMode | null) => void
} {
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const override = store.overrides[agentId]
  const effective: AutonomyMode = override ?? store.globalDefault
  const setMode = useCallback(
    (m: AutonomyMode | null) => {
      commit((s) => {
        const nextOverrides = { ...s.overrides }
        if (m === null) {
          delete nextOverrides[agentId]
        } else {
          nextOverrides[agentId] = m
        }
        return { ...s, overrides: nextOverrides }
      })
    },
    [agentId],
  )
  return {
    mode: override ?? effective,
    effective,
    isOverride: !!override,
    setMode,
  }
}

export function useAutonomyCounts(agentIds: ReadonlyArray<string>): {
  off: number
  approval: number
  auto: number
  total: number
  globalDefault: AutonomyMode
} {
  const store = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  let off = 0
  let approval = 0
  let auto = 0
  for (const id of agentIds) {
    const m = store.overrides[id] ?? store.globalDefault
    if (m === 'off') off++
    else if (m === 'approval') approval++
    else if (m === 'auto') auto++
  }
  return {
    off,
    approval,
    auto,
    total: agentIds.length,
    globalDefault: store.globalDefault,
  }
}

export const AUTONOMY_MODES: ReadonlyArray<AutonomyMode> = [
  'off',
  'approval',
  'auto',
]

export const AUTONOMY_LABEL: Record<AutonomyMode, string> = {
  off: 'Off',
  approval: 'Ask first',
  auto: 'Autonomous',
}

export const AUTONOMY_DESCRIPTION: Record<AutonomyMode, string> = {
  off: 'Dormant — will not act on its own. Explicit invocation only.',
  approval: 'Proposes actions and waits for human approval.',
  auto: 'Acts on its own. Use for trusted, scoped, reversible work.',
}
