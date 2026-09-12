import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../lib/supabase-constants'

export const Route = createFileRoute('/reset')({ ssr: false, component: ResetRoute })

// Implicit flow: the recovery email link redirects here with tokens in the URL hash,
// so no PKCE verifier is needed (works on any device/browser).
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: false, flowType: 'implicit' },
})

const wrap: CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#03040a', color: '#cfe0f5', fontFamily: 'Bahnschrift, ui-sans-serif, system-ui, sans-serif' }
const card: CSSProperties = { width: 'min(420px, 92vw)', background: '#0b131d', border: '1px solid #2b4a68', borderRadius: 12, padding: '26px 24px' }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', margin: '6px 0 14px', padding: '10px 12px', background: '#070d16', border: '1px solid #2b4a68', borderRadius: 7, color: '#eaf2ff', fontSize: 14 }
const btn: CSSProperties = { width: '100%', padding: '11px 12px', background: '#12314f', border: '1px solid #3a6da0', borderRadius: 7, color: '#eaf2ff', fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer' }

function ResetRoute() {
  const [ready, setReady] = useState(false)
  const [msg, setMsg] = useState('Checking your reset link…')
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => { if (alive && data.session) { setReady(true); setMsg('') } })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      if (event === 'PASSWORD_RECOVERY' || (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION'))) { setReady(true); setMsg('') }
    })
    const t = setTimeout(() => { if (alive) setMsg((m) => (ready ? '' : 'No recovery session found. Open the link from your password-reset email (or request a new one), then this page will let you set a new password.')) }, 1800)
    return () => { alive = false; sub.subscription.unsubscribe(); clearTimeout(t) }
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setMsg('Password must be at least 8 characters.')
    if (pw !== pw2) return setMsg('Passwords do not match.')
    setBusy(true); setMsg('')
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setMsg('Reset failed: ' + error.message)
    setDone(true)
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontWeight: 600, letterSpacing: '.2em', color: '#eaf2ff', marginBottom: 4 }}>PULSEOS</div>
        <div style={{ fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#7e98b4', marginBottom: 18 }}>Set a new password</div>
        {done ? (
          <div>
            <div style={{ color: '#10b981', marginBottom: 14 }}>Password updated.</div>
            <a href="/dashboard" style={{ ...btn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Go to sign in</a>
          </div>
        ) : ready ? (
          <form onSubmit={submit}>
            <label style={{ fontSize: 12, color: '#9fc0ea' }}>New password</label>
            <input style={input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            <label style={{ fontSize: 12, color: '#9fc0ea' }}>Confirm password</label>
            <input style={input} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <button style={btn} disabled={busy} type="submit">{busy ? 'Updating…' : 'Update password'}</button>
          </form>
        ) : null}
        {msg ? <div style={{ marginTop: 14, fontSize: 12.5, color: msg.startsWith('Reset failed') ? '#fe6b4b' : '#7e98b4', lineHeight: 1.5 }}>{msg}</div> : null}
      </div>
    </div>
  )
}