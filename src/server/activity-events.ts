import EventEmitter from 'node:events'
import type { ActivityEvent } from '../types/activity-event'

const MAX_ACTIVITY_EVENTS = 100
const ACTIVITY_EVENT_NAME = 'activity'

type ActivityEventCallback = (event: ActivityEvent) => void

// HMR safety: anchor the emitter + buffer in globalThis so subscribers
// registered before the module reload continue receiving events from the
// same singleton afterward. Without this, every save in dev creates a
// fresh emitter and orphans the prior subscribers.
const STATE_KEY = Symbol.for('clawsuite.activity_events.v1')
type ActivityEventsState = {
  emitter: EventEmitter
  buffer: Array<ActivityEvent>
}
const state: ActivityEventsState =
  ((globalThis as any)[STATE_KEY] as ActivityEventsState | undefined) ??
  (() => {
    const emitter = new EventEmitter()
    emitter.setMaxListeners(0)
    return { emitter, buffer: [] }
  })()
;(globalThis as any)[STATE_KEY] = state
const activityEmitter = state.emitter
const activityBuffer = state.buffer

export function pushEvent(event: ActivityEvent) {
  activityBuffer.push(event)
  if (activityBuffer.length > MAX_ACTIVITY_EVENTS) {
    activityBuffer.shift()
  }
  activityEmitter.emit(ACTIVITY_EVENT_NAME, event)
}

export function getRecentEvents(count = 50): Array<ActivityEvent> {
  const normalizedCount = Number.isFinite(count)
    ? Math.max(1, Math.min(MAX_ACTIVITY_EVENTS, Math.floor(count)))
    : 50

  if (activityBuffer.length <= normalizedCount) {
    return [...activityBuffer]
  }

  return activityBuffer.slice(activityBuffer.length - normalizedCount)
}

export function onEvent(callback: ActivityEventCallback) {
  activityEmitter.on(ACTIVITY_EVENT_NAME, callback)
}

export function offEvent(callback: ActivityEventCallback) {
  activityEmitter.off(ACTIVITY_EVENT_NAME, callback)
}
