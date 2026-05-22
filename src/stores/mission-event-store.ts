import { create } from 'zustand'
import type {
  MissionEvent,
  MissionEventInput,
} from '@/screens/gateway/lib/mission-events'

const MAX_EVENTS = 500

type MissionEventStore = {
  events: MissionEvent[]
  addEvent: (event: MissionEventInput) => MissionEvent
  clearEvents: () => void
  getAgentEvents: (agentId: string) => MissionEvent[]
}

function createEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function normalizeEvent(event: MissionEventInput): MissionEvent {
  return {
    ...event,
    id: event.id ?? createEventId(),
    timestamp: event.timestamp ?? Date.now(),
  } as MissionEvent
}

export const useMissionEventStore = create<MissionEventStore>()((set, get) => ({
  events: [],

  addEvent: (event) => {
    const nextEvent = normalizeEvent(event)

    set((state) => {
      const nextEvents =
        state.events.length >= MAX_EVENTS
          ? [
              ...state.events.slice(state.events.length - MAX_EVENTS + 1),
              nextEvent,
            ]
          : [...state.events, nextEvent]

      return { events: nextEvents }
    })

    return nextEvent
  },

  clearEvents: () => {
    set({ events: [] })
  },

  // WARNING: getAgentEvents returns a new array on every call. If you
  // subscribe to it as a Zustand selector — `useMissionEventStore(s =>
  // s.getAgentEvents(id))` — every unrelated event addition will trigger
  // a re-render (Zustand compares output references). Prefer subscribing
  // to `events` directly and memoizing the filter at the call site with
  // useMemo.
  getAgentEvents: (agentId) =>
    get().events.filter(
      (event) =>
        'agentId' in event.payload && event.payload.agentId === agentId,
    ),
}))
