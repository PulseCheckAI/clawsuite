// ── Users & Access (admin-only) ──────────────────────────────────────────────
// Manage dashboard accounts: list users, create a user, enable/disable.
// Backed by the admin-only /api/users (+ /api/users/$id) routes, which require
// MULTIUSER_AUTH + an admin session. This screen renders honest gating states
// when multi-user auth is off or the viewer is not an admin (no mock data).
// Themed via the MC_STYLE wrapper applied by the route.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Sourced } from '@/components/provenance/sourced'

type Role = 'admin'

interface UserRow {
  id: string
  email: string
  role: Role
  orgId: string | null
  disabled: boolean
  createdAt: string | null
}

interface AuthState {
  multiUser: boolean
  user: { email: string; role: Role; orgId: string | null } | null
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      {children}
    </div>
  )
}

function Info({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <Panel>
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
        </div>
      </Panel>
    </div>
  )
}

export function UsersScreen() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // create form (every account is an admin)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [formMsg, setFormMsg] = useState<string | null>(null)

  const loadAuth = useCallback(async () => {
    try {
      const r = await fetch('/api/auth-check')
      const d = await r.json()
      setAuth({ multiUser: Boolean(d.multiUser), user: d.user ?? null })
    } catch {
      setAuth({ multiUser: false, user: null })
    }
  }, [])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/users')
      const d = await r.json()
      if (!r.ok || !d.ok) {
        setError(d.error || `Failed to load users (${r.status})`)
        setUsers([])
      } else {
        setUsers(d.users as UserRow[])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAuth()
  }, [loadAuth])

  useEffect(() => {
    if (auth?.multiUser && auth.user?.role === 'admin') void loadUsers()
    else if (auth) setLoading(false)
  }, [auth, loadUsers])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setFormMsg(null)
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) {
        setFormMsg(d.error || `Failed (${r.status})`)
      } else {
        setEmail('')
        setPassword('')
        await loadUsers()
      }
    } catch (e) {
      setFormMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const toggleDisabled = async (u: UserRow) => {
    await fetch(`/api/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: !u.disabled }),
    }).catch(() => {})
    void loadUsers()
  }

  if (auth && !auth.multiUser) {
    return (
      <Info
        title="Multi-user auth is not enabled"
        body="Set MULTIUSER_AUTH=1 and a Supabase service-role key, apply the dashboard_users migration, then reload to manage accounts here."
      />
    )
  }
  if (auth && auth.user?.role !== 'admin') {
    return (
      <Info
        title="Admins only"
        body="User management is restricted to admin accounts."
      />
    )
  }

  const inputCls =
    'w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-sky-400/60 focus:ring-1 focus:ring-sky-400/40'
  const btnCls =
    'cursor-pointer rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="h-full overflow-y-auto p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">
          Users &amp; Access
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Admin-only. Accounts authenticate with their own email + password;
          roles map to OpenClaw operator scopes.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* User list */}
        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              Accounts
            </h2>
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="cursor-pointer text-xs text-slate-400 transition-colors hover:text-slate-200"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-lg bg-white/[0.04]"
                />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : !users || users.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              No users yet. Create the first one on the right.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Created</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-white/5">
                      <td className="py-2.5 pr-3">{u.email}</td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={
                            u.disabled ? 'text-rose-300' : 'text-emerald-300'
                          }
                        >
                          {u.disabled ? 'disabled' : 'active'}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate-500">
                        {u.createdAt ? (
                          <Sourced
                            source={{
                              kind: 'sql',
                              ref: 'public.dashboard_users',
                              freshness: u.createdAt,
                            }}
                          >
                            {new Date(u.createdAt).toLocaleDateString()}
                          </Sourced>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void toggleDisabled(u)}
                          className="cursor-pointer text-xs text-slate-400 transition-colors hover:text-slate-100"
                        >
                          {u.disabled ? 'Enable' : 'Disable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* Create user */}
        <Panel>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
            Create user
          </h2>
          <form onSubmit={onCreate} className="space-y-3">
            <div>
              <label
                htmlFor="nu-email"
                className="mb-1 block text-xs text-slate-400"
              >
                Email
              </label>
              <input
                id="nu-email"
                type="email"
                required
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="person@company.com"
              />
            </div>
            <div>
              <label
                htmlFor="nu-pw"
                className="mb-1 block text-xs text-slate-400"
              >
                Initial password
              </label>
              <input
                id="nu-pw"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="min 8 characters"
              />
            </div>
            <p className="text-xs text-slate-500">
              New accounts are created as{' '}
              <span className="text-slate-300">admins</span> with full access.
            </p>
            {formMsg ? (
              <p className="text-sm text-rose-300">{formMsg}</p>
            ) : null}
            <button type="submit" disabled={creating} className={btnCls}>
              {creating ? 'Creating…' : 'Create user'}
            </button>
          </form>
        </Panel>
      </div>
    </div>
  )
}
