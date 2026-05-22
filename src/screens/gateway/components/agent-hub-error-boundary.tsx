import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null; resetKey: number }

export class AgentHubErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surface the original error so recovery doesn't make the underlying cause
    // invisible — without this, a crash + Try again loop produces no log trail.
    console.error('[AgentHubErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-[400px] items-center justify-center p-8 text-center">
          <div>
            <p className="text-3xl mb-3">⚠️</p>
            <p className="text-base font-semibold text-red-400">
              Something went wrong
            </p>
            <p className="mt-1 text-sm text-primary-500 max-w-sm">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() =>
                this.setState((s) => ({
                  error: null,
                  resetKey: s.resetKey + 1,
                }))
              }
              className="mt-4 rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    // Keyed wrapper forces a full remount of the child tree on Try again —
    // without this, stale state from the crash re-throws immediately.
    return <div key={this.state.resetKey}>{this.props.children}</div>
  }
}
