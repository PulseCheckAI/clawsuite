import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyAccentColor } from '@/lib/accent-colors'

export type SettingsThemeMode = 'system' | 'light' | 'dark'
export type AccentColor = 'orange' | 'purple' | 'blue' | 'green'

export type StudioSettings = {
  gatewayUrl: string
  gatewayToken: string
  theme: SettingsThemeMode
  accentColor: AccentColor
  editorFontSize: number
  editorWordWrap: boolean
  editorMinimap: boolean
  notificationsEnabled: boolean
  usageThreshold: number
  smartSuggestionsEnabled: boolean
  preferredBudgetModel: string
  preferredPremiumModel: string
  onlySuggestCheaper: boolean
  showSystemMetricsFooter: boolean
  /** Mobile chat nav mode: 'dock' = iMessage (no nav in chat), 'integrated' = chat input in nav pill, 'scroll-hide' = nav shows on scroll up */
  mobileChatNavMode: 'dock' | 'integrated' | 'scroll-hide'
}

type SettingsState = {
  settings: StudioSettings
  updateSettings: (updates: Partial<StudioSettings>) => void
}

export const defaultStudioSettings: StudioSettings = {
  gatewayUrl: '',
  gatewayToken: '',
  theme: 'system',
  accentColor: 'orange',
  editorFontSize: 13,
  editorWordWrap: true,
  editorMinimap: false,
  notificationsEnabled: true,
  usageThreshold: 80,
  smartSuggestionsEnabled: false,
  preferredBudgetModel: '',
  preferredPremiumModel: '',
  onlySuggestCheaper: false,
  showSystemMetricsFooter: false,
  mobileChatNavMode: 'dock',
}

function resolveStoredAccent(value: string | null): AccentColor | null {
  return value === 'purple' ||
    value === 'blue' ||
    value === 'green' ||
    value === 'orange'
    ? value
    : null
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    function createSettingsStore(set) {
      return {
        settings: defaultStudioSettings,
        updateSettings: function updateSettings(updates) {
          set(function applyUpdates(state) {
            return {
              settings: {
                ...state.settings,
                ...updates,
              },
            }
          })
        },
      }
    },
    {
      name: 'openclaw-settings',
      skipHydration: true,
    },
  ),
)

export function useSettings() {
  const settings = useSettingsStore(function selectSettings(state) {
    return state.settings
  })
  const updateSettings = useSettingsStore(function selectUpdateSettings(state) {
    return state.updateSettings
  })

  return {
    settings,
    updateSettings,
  }
}

export function resolveTheme(theme: SettingsThemeMode): 'light' | 'dark' {
  if (theme === 'light') return 'light'
  if (theme === 'dark') return 'dark'

  if (typeof window === 'undefined') return 'dark'
  // Mission Control is dark-first. If user has not explicitly chosen
  // paper-light, treat 'system' as dark regardless of OS preference.
  const stored = localStorage.getItem('clawsuite-theme')
  if (stored === 'paper-light') return 'light'
  return 'dark'
}

export function applyTheme(theme: SettingsThemeMode) {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  const media = window.matchMedia('(prefers-color-scheme: dark)')

  // Precedence: explicit enterprise theme in localStorage wins over the
  // appTheme/system preference. This makes Mission Control dark-first by
  // default (pulsecheck-navy) while still letting the user pick paper-light.
  const stored = localStorage.getItem('clawsuite-theme')
  const DARK_ENTERPRISE = [
    'pulsecheck-navy',
    'ops-dark',
    'premium-dark',
    'sunset-brand',
  ]
  const isStoredDark = DARK_ENTERPRISE.includes(stored ?? '')
  const isStoredLight = stored === 'paper-light'

  // Default appTheme when 'system' resolves to LIGHT on the OS: still treat
  // as dark unless the user explicitly chose paper-light. PulseOS is a
  // Mission Control dashboard — dark-first by design.
  const resolvedDark = isStoredDark
    ? true
    : isStoredLight
      ? false
      : theme === 'dark'
        ? true
        : theme === 'light'
          ? false
          : !isStoredLight // theme==='system': default to dark, opt out via paper-light

  root.classList.remove('light', 'dark', 'system')
  root.classList.add(resolvedDark ? 'dark' : 'light')

  // Sync data-theme so CSS variable overrides don't fight Tailwind dark: classes.
  if (resolvedDark) {
    root.setAttribute(
      'data-theme',
      isStoredDark ? (stored as string) : 'pulsecheck-navy',
    )
  } else {
    root.setAttribute('data-theme', 'paper-light')
  }
  // Suppress unused-variable warnings for system-media reference (kept for
  // possible future listener wiring elsewhere)
  void media

  const storedAccent =
    resolveStoredAccent(localStorage.getItem('clawsuite-accent')) || 'orange'
  root.setAttribute('data-accent', storedAccent)
}

function applySettingsAppearance(settings: StudioSettings) {
  applyTheme(settings.theme)
  const storedAccent = resolveStoredAccent(
    localStorage.getItem('clawsuite-accent'),
  )
  applyAccentColor(storedAccent ?? settings.accentColor)
}

let didInitializeSettingsAppearance = false

export function initializeSettingsAppearance() {
  if (didInitializeSettingsAppearance) return
  if (typeof window === 'undefined') return

  didInitializeSettingsAppearance = true

  // Rehydrate persisted settings from localStorage (skipHydration: true requires manual call)
  void useSettingsStore.persist.rehydrate()

  applySettingsAppearance(useSettingsStore.getState().settings)

  useSettingsStore.subscribe(
    function handleSettingsChange(state, previousState) {
      const nextSettings = state.settings
      const previousSettings = previousState.settings

      if (nextSettings.theme !== previousSettings.theme) {
        applyTheme(nextSettings.theme)
      }

      if (nextSettings.accentColor !== previousSettings.accentColor) {
        localStorage.setItem('clawsuite-accent', nextSettings.accentColor)
        applyAccentColor(nextSettings.accentColor)
      }
    },
  )
}
