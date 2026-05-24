import { useEffect, useState, FormEvent } from 'react'
import {
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
  type Variants,
} from 'motion/react'

const EMBERS = [
  { left: '12%', size: '3px', dur: '11s', delay: '0s' },
  { left: '26%', size: '2px', dur: '14s', delay: '2.5s' },
  { left: '41%', size: '4px', dur: '9.5s', delay: '1.2s' },
  { left: '57%', size: '2.5px', dur: '13s', delay: '4s' },
  { left: '68%', size: '3px', dur: '10.5s', delay: '0.6s' },
  { left: '79%', size: '2px', dur: '15s', delay: '3.2s' },
  { left: '90%', size: '3.5px', dur: '12s', delay: '5.5s' },
] as const

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [multiUser, setMultiUser] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const reduce = useReducedMotion()

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth-check')
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setMultiUser(Boolean(d.multiUser))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(multiUser ? { email, password } : { password }),
      })
      const data = await res.json()

      if (data.ok) {
        window.location.reload()
      } else {
        setError(
          data.error ||
            (multiUser ? 'Invalid credentials' : 'Invalid password'),
        )
        setLoading(false)
      }
    } catch {
      setError('Authentication failed. Please try again.')
      setLoading(false)
    }
  }

  const canSubmit = multiUser ? Boolean(email && password) : Boolean(password)

  const bgVariant: Variants = {
    hidden: { opacity: 0, scale: 1.15 },
    visible: {
      opacity: 1,
      scale: reduce ? 1.15 : [1.15, 1.24, 1.15],
      x: reduce ? '0%' : ['0%', '-2.5%', '0%'],
      y: reduce ? '0%' : ['0%', '1.5%', '0%'],
      transition: {
        opacity: { duration: 1.6, ease: 'easeOut' },
        scale: { duration: 28, ease: 'easeInOut', repeat: Infinity },
        x: { duration: 28, ease: 'easeInOut', repeat: Infinity },
        y: { duration: 34, ease: 'easeInOut', repeat: Infinity },
      },
    },
  }

  const topbarVariant: Variants = {
    hidden: { y: -20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
    },
  }

  const cardVariant: Variants = {
    hidden: { y: 40, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.8,
        ease: [0.16, 1, 0.3, 1],
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  }

  const itemVariant: Variants = {
    hidden: { y: 15, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: { type: 'spring', stiffness: 420, damping: 30 },
    },
  }

  return (
    <>
      <style>{`
        .cn-wrapper {
          position: fixed;
          inset: 0;
          overflow: hidden;
          background: #06080F;
          font-family: 'Bricolage Grotesque', 'Inter', sans-serif;
          color: #F5F0E8;
          display: flex;
          flex-direction: column;
        }
        .cn-bg-container {
          position: absolute;
          inset: 0;
          overflow: hidden;
          z-index: 1;
        }
        .cn-bg-img {
          position: absolute;
          inset: -10%;
          width: 120%;
          height: 120%;
          background-image: url('/pulseos-login-bg.webp');
          background-size: cover;
          background-position: center 30%;
          will-change: transform, opacity;
        }
        .cn-glimmer {
          position: absolute;
          top: 0;
          left: -10%;
          right: -10%;
          height: 62%;
          z-index: 1;
          pointer-events: none;
          background: linear-gradient(
            100deg,
            transparent 18%,
            rgba(255, 120, 60, 0.1) 38%,
            rgba(255, 180, 90, 0.17) 50%,
            rgba(255, 209, 102, 0.1) 62%,
            transparent 82%
          );
          mix-blend-mode: screen;
          will-change: transform, opacity;
          animation: cnGlimmer 11s ease-in-out infinite;
        }
        @keyframes cnGlimmer {
          0% { transform: translateX(-7%); opacity: 0.35; }
          50% { transform: translateX(7%); opacity: 0.85; }
          100% { transform: translateX(-7%); opacity: 0.35; }
        }
        .cn-bg-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(6,8,15,0.12) 0%, rgba(6,8,15,0.42) 42%, rgba(6,8,15,0.9) 76%, #06080F 100%);
          z-index: 2;
        }
        .cn-glow {
          position: absolute;
          top: -10%;
          left: 50%;
          transform: translateX(-50%);
          width: 80vw;
          height: 80vw;
          max-width: 800px;
          max-height: 800px;
          background: radial-gradient(circle 50% 50% at 50% 50%, rgba(255, 107, 53, 0.25) 0%, transparent 70%);
          pointer-events: none;
          z-index: 3;
          mix-blend-mode: screen;
        }
        .cn-topbar {
          position: relative;
          z-index: 10;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 24px 32px;
          width: 100%;
          box-sizing: border-box;
        }
        .cn-brand-lockup {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cn-wave-icon {
          width: 24px;
          height: auto;
        }
        .cn-wordmark {
          font-size: 1.25rem;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .cn-os {
          background: linear-gradient(90deg, #E63946 0%, #FF6B35 40%, #FF9F1C 70%, #FFD166 100%);
          background-size: 220% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: cnShimmer 5.5s ease-in-out infinite;
        }
        .cn-cmd-center {
          font-family: monospace;
          font-size: 0.75rem;
          color: rgba(245, 240, 232, 0.5);
          letter-spacing: 0.1em;
        }
        .cn-main {
          flex: 1;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding-bottom: 8%;
          position: relative;
          z-index: 10;
        }
        .cn-card {
          width: 100%;
          max-width: 420px;
          background: rgba(12, 14, 20, 0.45);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 107, 53, 0.15);
          border-radius: 20px;
          padding: 40px;
          box-sizing: border-box;
          box-shadow: 0 32px 64px -16px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05);
          display: flex;
          flex-direction: column;
        }
        .cn-eyebrow {
          font-family: monospace;
          color: #FF9F1C;
          font-size: 0.75rem;
          letter-spacing: 0.05em;
          margin-bottom: 16px;
        }
        .cn-title {
          font-size: 2rem;
          font-weight: 600;
          letter-spacing: -0.03em;
          margin: 0 0 8px 0;
          color: #F5F0E8;
        }
        .cn-subtitle {
          font-size: 0.95rem;
          color: rgba(245, 240, 232, 0.6);
          margin: 0 0 32px 0;
          line-height: 1.4;
        }
        .cn-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .cn-input-wrapper {
          position: relative;
          width: 100%;
        }
        .cn-input-icon {
          position: absolute;
          left: 16px;
          top: 50%;
          transform: translateY(-50%);
          width: 18px;
          height: 18px;
          color: rgba(245, 240, 232, 0.4);
          pointer-events: none;
          transition: color 0.3s ease;
        }
        .cn-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 16px 16px 16px 44px;
          font-family: inherit;
          font-size: 0.95rem;
          color: #F5F0E8;
          box-sizing: border-box;
          transition: all 0.3s ease;
        }
        .cn-input::placeholder {
          color: rgba(245, 240, 232, 0.3);
        }
        .cn-input:focus {
          outline: none;
          border-color: #FF6B35;
          box-shadow: 0 0 0 1px #FF6B35, 0 0 20px rgba(255, 107, 53, 0.15);
        }
        .cn-input:focus + .cn-input-icon,
        .cn-input-wrapper:focus-within .cn-input-icon {
          color: #FF6B35;
        }
        .cn-error {
          background: rgba(230, 57, 70, 0.1);
          border: 1px solid rgba(230, 57, 70, 0.3);
          border-radius: 10px;
          padding: 12px 16px;
          color: #FFD166;
          font-size: 0.85rem;
          margin-top: 8px;
        }
        .cn-btn {
          position: relative;
          background: linear-gradient(90deg, #E63946 0%, #FF6B35 40%, #FF9F1C 70%, #FFD166 100%);
          color: #1A0E06;
          border: none;
          border-radius: 12px;
          padding: 16px;
          font-family: inherit;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          margin-top: 8px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          transition: filter 0.3s ease, opacity 0.3s ease;
        }
        .cn-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .cn-btn:hover:not(:disabled) {
          filter: brightness(1.15);
        }
        .cn-btn:focus-visible {
          outline: 2px solid #F5F0E8;
          outline-offset: 2px;
        }
        .cn-btn::after {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 40%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
          transform: skewX(-20deg);
          transition: 0.6s ease;
        }
        .cn-btn:hover:not(:disabled)::after {
          left: 150%;
        }
        .cn-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(26, 14, 6, 0.2);
          border-top-color: #1A0E06;
          border-radius: 50%;
          animation: cn-spin 0.8s linear infinite;
        }
        @keyframes cn-spin {
          to { transform: rotate(360deg); }
        }
        .cn-footer {
          margin-top: 32px;
          font-family: monospace;
          font-size: 0.65rem;
          color: rgba(245, 240, 232, 0.3);
          text-align: center;
          letter-spacing: 0.05em;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border-width: 0;
        }
        .cn-beams {
          position: absolute;
          inset: -25%;
          z-index: 2;
          pointer-events: none;
          background: linear-gradient(
            115deg,
            transparent 34%,
            rgba(255, 150, 70, 0.1) 46%,
            rgba(255, 209, 102, 0.18) 50%,
            rgba(255, 110, 60, 0.1) 54%,
            transparent 66%
          );
          mix-blend-mode: screen;
          will-change: transform, opacity;
          animation: cnBeams 13s ease-in-out infinite;
        }
        @keyframes cnBeams {
          0% { transform: translate3d(-12%, -7%, 0); opacity: 0.45; }
          50% { transform: translate3d(11%, 7%, 0); opacity: 0.9; }
          100% { transform: translate3d(-12%, -7%, 0); opacity: 0.45; }
        }
        .cn-aura {
          position: absolute;
          top: 33%;
          left: 50%;
          width: 48vw;
          height: 48vw;
          max-width: 540px;
          max-height: 540px;
          transform: translate(-50%, -50%);
          z-index: 3;
          pointer-events: none;
          border-radius: 50%;
          background: conic-gradient(
            from 0deg,
            transparent 0deg,
            rgba(255, 107, 53, 0.16) 60deg,
            transparent 140deg,
            rgba(255, 209, 102, 0.14) 230deg,
            transparent 320deg
          );
          filter: blur(26px);
          mix-blend-mode: screen;
          will-change: transform;
          animation: cnSpin 20s linear infinite;
        }
        @keyframes cnSpin {
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }
        .cn-embers {
          position: absolute;
          inset: 0;
          z-index: 4;
          pointer-events: none;
          overflow: hidden;
        }
        .cn-ember {
          position: absolute;
          bottom: -10px;
          border-radius: 50%;
          background: radial-gradient(circle, #FFD166, rgba(255, 107, 53, 0.5) 60%, transparent 72%);
          opacity: 0;
          will-change: transform, opacity;
          animation: cnFloat linear infinite;
        }
        @keyframes cnFloat {
          0% { transform: translateY(0) translateX(0) scale(1); opacity: 0; }
          12% { opacity: 0.85; }
          85% { opacity: 0.6; }
          100% { transform: translateY(-82vh) translateX(18px) scale(0.35); opacity: 0; }
        }
        @keyframes cnShimmer {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @media (max-width: 720px) {
          .cn-topbar {
            padding: 20px;
          }
          .cn-wordmark {
            font-size: 1.1rem;
          }
          .cn-cmd-center {
            display: none;
          }
          .cn-main {
            padding: 0 20px 24px 20px;
            align-items: center;
          }
          .cn-card {
            max-width: 380px;
            padding: 32px 24px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .cn-btn::after {
            display: none;
          }
          .cn-bg-img,
          .cn-os {
            animation: none;
            transition: none;
          }
          .cn-beams,
          .cn-aura,
          .cn-embers,
          .cn-glimmer {
            display: none;
          }
        }
      `}</style>

      <LazyMotion features={domAnimation}>
        <div className="cn-wrapper">
          <div className="cn-bg-container">
            <m.div
              className="cn-bg-img"
              variants={bgVariant}
              initial="hidden"
              animate="visible"
            />
            {!reduce && <div className="cn-glimmer" aria-hidden="true" />}
            <div className="cn-bg-overlay" />
            {!reduce && (
              <div className="cn-embers" aria-hidden="true">
                {EMBERS.map((e, i) => (
                  <span
                    key={i}
                    className="cn-ember"
                    style={{
                      left: e.left,
                      width: e.size,
                      height: e.size,
                      animationDuration: e.dur,
                      animationDelay: e.delay,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <m.header
            className="cn-topbar"
            variants={topbarVariant}
            initial="hidden"
            animate="visible"
          >
            <div className="cn-brand-lockup">
              <img src="/pulsecheck-wave.svg" alt="" className="cn-wave-icon" />
              <div className="cn-wordmark">
                Pulse<span className="cn-os">OS</span>
              </div>
            </div>
            <div className="cn-cmd-center">COMMAND CENTER</div>
          </m.header>

          <main className="cn-main">
            <m.div
              className="cn-card"
              variants={cardVariant}
              initial="hidden"
              animate="visible"
            >
              <m.div variants={itemVariant} className="cn-eyebrow">
                [ SECURE GATEWAY ]
              </m.div>

              <m.h1 variants={itemVariant} className="cn-title">
                {multiUser ? 'Sign in' : 'Enter password'}
              </m.h1>

              <m.p variants={itemVariant} className="cn-subtitle">
                {multiUser
                  ? 'Sign in with your PulseOS account'
                  : 'This workspace is password-protected'}
              </m.p>

              <m.form
                variants={itemVariant}
                className="cn-form"
                onSubmit={handleSubmit}
              >
                {multiUser && (
                  <div className="cn-input-wrapper">
                    <label htmlFor="login-email" className="sr-only">
                      Email
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      className="cn-input"
                      autoComplete="username"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus
                    />
                    <svg
                      className="cn-input-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="M4 7.00005L10.2 11.65C11.2667 12.45 12.7333 12.45 13.8 11.65L20 7" />
                    </svg>
                  </div>
                )}

                <div className="cn-input-wrapper">
                  <label htmlFor="login-password" className="sr-only">
                    Password
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    className="cn-input"
                    autoComplete={multiUser ? 'current-password' : 'off'}
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus={!multiUser}
                  />
                  <svg
                    className="cn-input-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>

                {error && (
                  <div className="cn-error" role="alert">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="cn-btn"
                  disabled={loading || !canSubmit}
                >
                  {loading && <div className="cn-spinner" />}
                  {loading
                    ? 'Authenticating...'
                    : multiUser
                      ? 'Sign in'
                      : 'Continue'}
                </button>
              </m.form>

              <m.div variants={itemVariant} className="cn-footer">
                ENCRYPTED SESSION · PULSECHECK AI · v4.0
              </m.div>
            </m.div>
          </main>
        </div>
      </LazyMotion>
    </>
  )
}
