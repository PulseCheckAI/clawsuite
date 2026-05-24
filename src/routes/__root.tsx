import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouter,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
// Direct side-effect import — Vite owns stylesheet HMR. Importing as ?url
// and feeding it to TanStack head.links makes React 19's mountHoistable
// fight Vite's stylesheet swap on every CSS hot-update, throwing
// "removeChild on Node" on every save.
import '../styles.css'
import { SearchModal } from '@/components/search/search-modal'
import { TerminalShortcutListener } from '@/components/terminal-shortcut-listener'
import { GlobalShortcutListener } from '@/components/global-shortcut-listener'
import { WorkspaceShell } from '@/components/workspace-shell'
import { useTaskReminders } from '@/hooks/use-task-reminders'
import { UpdateNotifier } from '@/components/update-notifier'
import { OpenClawUpdateNotifier } from '@/components/openclaw-update-notifier'
import { MobilePromptTrigger } from '@/components/mobile-prompt/MobilePromptTrigger'
import { Toaster } from '@/components/ui/toast'
import { OnboardingTour } from '@/components/onboarding/onboarding-tour'
import { KeyboardShortcutsModal } from '@/components/keyboard-shortcuts-modal'
import { CompactionNotifier } from '@/components/compaction-notifier'
import { FallbackBanner } from '@/components/fallback-banner'
import { GatewayRestartProvider } from '@/components/gateway-restart-overlay'
import { ExecApprovalToast } from '@/components/exec-approval-toast'
import { GatewayStatusToast } from '@/components/gateway-status-toast'
import { initializeSettingsAppearance } from '@/hooks/use-settings'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTerminalPanelStore } from '@/stores/terminal-panel-store'
import { useTaskStore } from '@/stores/task-store'
import { useMissionStore } from '@/stores/mission-store'

// CSP is delivered as an HTTP response header (see vite.config.ts server.headers).
// Meta-tag delivery is ignored by Chrome for navigation-sensitive directives like
// frame-ancestors (logged "frame-ancestors is ignored when delivered via meta"
// 5× per page load). The header form is honored end-to-end. The 'unsafe-inline'
// script-src is still present pending a separate nonce-injection PR.

const themeScript = `
(() => {
  window.process = window.process || { env: {}, platform: 'browser' };
  
  // Gateway connection via PulseOS server proxy.
  // Clients connect to /ws-gateway on the PulseOS server (same host:port as the page).
  // The server proxies internally to ws://127.0.0.1:18789 — so phone/LAN/Docker
  // users never need direct access to port 18789.
  // Manual override: set gatewayUrl in settings to skip proxy (e.g. wss:// remote).
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem('openclaw-settings')
      const parsed = stored ? JSON.parse(stored) : null
      const manualUrl = parsed?.state?.settings?.gatewayUrl
      if (manualUrl && typeof manualUrl === 'string' && manualUrl.startsWith('ws')) {
        window.__GATEWAY_URL__ = manualUrl
      } else {
        // Use proxy path — works from any device that can reach PulseOS
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        window.__GATEWAY_URL__ = proto + '//' + window.location.host + '/ws-gateway'
      }
    } catch {
      window.__GATEWAY_URL__ = 'ws://127.0.0.1:18789'
    }
  }
  
  try {
    const stored = localStorage.getItem('openclaw-settings')
    const fallback = localStorage.getItem('chat-settings')
    let theme = 'light'
    let accent = 'orange'
    if (stored) {
      const parsed = JSON.parse(stored)
      const storedTheme = parsed?.state?.settings?.theme
      const storedAccent = parsed?.state?.settings?.accentColor
      if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
        theme = storedTheme
      }
      if (storedAccent === 'orange' || storedAccent === 'purple' || storedAccent === 'blue' || storedAccent === 'green') {
        accent = storedAccent
      }
    } else if (fallback) {
      const parsed = JSON.parse(fallback)
      const storedTheme = parsed?.state?.settings?.theme
      const storedAccent = parsed?.state?.settings?.accentColor
      if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
        theme = storedTheme
      }
      if (storedAccent === 'orange' || storedAccent === 'purple' || storedAccent === 'blue' || storedAccent === 'green') {
        accent = storedAccent
      }
    }
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    // PulseOS theme class + data-theme attribute
    // One-shot migration: any legacy dark theme (ops-dark / premium-dark
    // / sunset-brand) gets upgraded to pulsecheck-navy. Users who want a
    // different theme can switch in Settings AFTER this fires; the
    // migration only runs once per pre-navy stored value.
    let enterpriseTheme = localStorage.getItem('clawsuite-theme')
    const NAVY_MIGRATION_KEY = 'clawsuite-navy-migrated-v1'
    if (
      !localStorage.getItem(NAVY_MIGRATION_KEY) &&
      (enterpriseTheme === 'ops-dark' ||
        enterpriseTheme === 'premium-dark' ||
        enterpriseTheme === 'sunset-brand')
    ) {
      enterpriseTheme = 'pulsecheck-navy'
      localStorage.setItem('clawsuite-theme', 'pulsecheck-navy')
      localStorage.setItem(NAVY_MIGRATION_KEY, '1')
    }
    const isValidEnterpriseTheme =
      enterpriseTheme === 'pulsecheck-navy' ||
      enterpriseTheme === 'ops-dark' ||
      enterpriseTheme === 'premium-dark' ||
      enterpriseTheme === 'paper-light' ||
      enterpriseTheme === 'sunset-brand'
    root.classList.remove(
      'paper-light',
      'pulsecheck-navy',
      'ops-dark',
      'premium-dark',
      'sunset-brand',
    )
    if (isValidEnterpriseTheme) {
      root.setAttribute('data-theme', enterpriseTheme)
      root.classList.add(enterpriseTheme)
      if (
        enterpriseTheme === 'pulsecheck-navy' ||
        enterpriseTheme === 'ops-dark' ||
        enterpriseTheme === 'premium-dark' ||
        enterpriseTheme === 'sunset-brand'
      ) {
        theme = 'dark'
      } else {
        theme = 'light'
      }
    } else {
      // No stored theme yet — default to pulsecheck-navy (Mission Control look)
      root.setAttribute('data-theme', 'pulsecheck-navy')
      root.classList.add('pulsecheck-navy')
      theme = 'dark'
    }
    const apply = () => {
      root.classList.remove('light', 'dark', 'system')
      root.classList.add(theme)
      root.setAttribute('data-accent', accent)
      if (theme === 'system' && media.matches) {
        root.classList.add('dark')
      }
    }
    apply()
    media.addEventListener('change', () => {
      if (theme === 'system') apply()
    })
  } catch {}
})()
`

const themeColorScript = `
(() => {
  try {
    const root = document.documentElement
    const enterpriseTheme = localStorage.getItem('clawsuite-theme')
    const settingsRaw = localStorage.getItem('openclaw-settings')
    let appTheme = 'light'
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw)
      const saved = parsed?.state?.settings?.theme
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        appTheme = saved
      }
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const darkEnterprise =
      enterpriseTheme === 'pulsecheck-navy' ||
      enterpriseTheme === 'ops-dark' ||
      enterpriseTheme === 'premium-dark' ||
      enterpriseTheme === 'sunset-brand'
    const isDark = darkEnterprise
      ? true
      : enterpriseTheme === 'paper-light'
        ? false
        : appTheme === 'dark' || (appTheme === 'system' && prefersDark)
    // Navy hex matches oklch(0.18 0.08 248) — the page bg for pulsecheck-navy
    const navyHex = '#0e1730'
    const nextColor = isDark
      ? enterpriseTheme === 'pulsecheck-navy'
        ? navyHex
        : '#0f172a'
      : '#f97316'

    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', nextColor)
    root.style.setProperty('color-scheme', isDark ? 'dark' : 'light')
  } catch {}
})()
`

export const Route = createRootRoute({
  // Pure SPA mode — SSR is broken on this stack today (TanStack Start
  // hydration: <AwaitInner> -> setState undefined). Disable SSR root-wide;
  // every route inherits this until upstream #53 is properly fixed.
  ssr: false,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content:
          'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual',
      },
      {
        title: 'PulseOS',
      },
      {
        name: 'description',
        content:
          'Supercharged chat interface for OpenClaw AI agents with file explorer, terminal, and usage tracking',
      },
      {
        property: 'og:image',
        content: '/cover.png',
      },
      {
        property: 'og:image:type',
        content: 'image/png',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        name: 'twitter:image',
        content: '/cover.png',
      },
      // PWA meta tags
      {
        name: 'theme-color',
        content: '#f97316',
      },
      {
        name: 'apple-mobile-web-app-capable',
        content: 'yes',
      },
      {
        name: 'apple-mobile-web-app-status-bar-style',
        content: 'default',
      },
    ],
    links: [
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/favicon.svg',
      },
      // PWA manifest and icons
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
      {
        rel: 'apple-touch-icon',
        href: '/apple-touch-icon.png',
        sizes: '180x180',
      },
    ],
  }),

  shellComponent: RootDocument,
  component: RootLayout,
  errorComponent: function RootError({ error }) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 text-center bg-primary-50">
        <h1 className="text-2xl font-semibold text-primary-900 mb-4">
          Something went wrong
        </h1>
        <pre className="p-4 bg-primary-100 rounded-lg text-sm text-primary-700 max-w-full overflow-auto mb-6">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <button
          onClick={() => (window.location.href = '/')}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
        >
          Return Home
        </button>
      </div>
    )
  },
})

const queryClient = new QueryClient()

function TaskReminderRunner() {
  useTaskReminders()
  return null
}

function RootLayout() {
  // Unregister any existing service workers — they cause stale asset issues
  // after Docker image updates and behind reverse proxies (Pangolin, Cloudflare, etc.)
  useEffect(() => {
    // Rehydrate zustand persist stores client-side. Stores use skipHydration:true
    // to avoid SSR localStorage access (which throws and trips TanStack's
    // <AwaitInner> -> setState undefined hydration crash). Manual rehydrate
    // here loads localStorage state after mount.
    void useWorkspaceStore.persist.rehydrate()
    void useTerminalPanelStore.persist.rehydrate()
    void useTaskStore.persist.rehydrate()
    void useMissionStore.persist.rehydrate()

    initializeSettingsAppearance()

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          registration.unregister()
        }
      })
      // Also clear any stale caches
      if ('caches' in window) {
        caches.keys().then((names) => {
          for (const name of names) {
            caches.delete(name)
          }
        })
      }
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <GatewayRestartProvider>
        <CompactionNotifier />
        <FallbackBanner />
        <GlobalShortcutListener />
        <TerminalShortcutListener />
        <TaskReminderRunner />
        <UpdateNotifier />
        <OpenClawUpdateNotifier />
        <MobilePromptTrigger />
        <Toaster />
        <ExecApprovalToast />
        <GatewayStatusToast />
        <WorkspaceShell />
        <SearchModal />
        <OnboardingTour />
        <KeyboardShortcutsModal />
      </GatewayRestartProvider>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  // Per-request CSP nonce (prod only) — stamped on every inline script so prod
  // can drop script-src 'unsafe-inline'. undefined in dev/client (CSP unchanged).
  const nonce = useRouter().options.ssr?.nonce
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* CSP is an HTTP response header (serve.mjs / vite.config.ts); these
            inline scripts carry the matching per-request nonce so prod can drop
            script-src 'unsafe-inline'. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        <HeadContent />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeColorScript }}
        />
      </head>
      <body suppressHydrationWarning>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
          (function(){
            if (document.getElementById('splash-screen')) return;
            // Default splash to the Mission Control deep-navy so there's no
            // first-paint grey flash and it matches the dashboard surface.
            var bg = '#070A11', txt = '#E6F1FF', muted = '#8FA3BF';
            try {
              var enterprise = localStorage.getItem('clawsuite-theme');
              var s = localStorage.getItem('openclaw-settings');
              var t = 'dark';
              if (
                enterprise === 'pulsecheck-navy' ||
                enterprise === 'ops-dark' ||
                enterprise === 'premium-dark' ||
                enterprise === 'sunset-brand'
              ) {
                t = 'dark';
              } else if (enterprise === 'paper-light') {
                t = 'light';
              } else if (s) {
                var p = JSON.parse(s);
                t = (p && p.state && p.state.settings && p.state.settings.theme) || 'dark';
              }
              if (t === 'system') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
              if (t === 'light') { bg = '#f8fafc'; txt = '#0f172a'; muted = '#64748b'; }
              else if (enterprise === 'premium-dark') { bg = '#000000'; }
              else if (enterprise === 'ops-dark') { bg = '#1e1e2e'; }
              else if (enterprise === 'sunset-brand') { bg = '#1a0e05'; }
              // else: pulsecheck-navy (default) — bg stays #070A11 (Mission Control)
            } catch(e){}

            var quips = ["Initializing command center","Connecting to gateway","Syncing the agent fleet","Loading mission control","Calibrating telemetry","Establishing secure channel","Spinning up the swarm","Aligning data planes","Priming the control plane","Warming the neural core","Mapping the constellation","Engaging autonomy systems"];
            var quip = quips[Math.floor(Math.random() * quips.length)];
            var accent = (typeof t !== 'undefined' && t === 'light') ? '#0E7490' : '#FFB547';

            var d = document.createElement('div');
            d.id = 'splash-screen';
            d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;overflow:hidden;background:'+bg+';transition:opacity .7s ease, filter .7s ease, transform .7s ease;';
            d.style.setProperty('--sp-txt', txt);
            d.style.setProperty('--sp-muted', muted);
            d.style.setProperty('--sp-accent', accent);
            d.innerHTML = '<div class="sp-aurora"></div><div class="sp-grid"></div><div class="sp-grain"></div><div class="sp-vignette"></div>'
              + '<div class="sp-stack">'
              + '<div class="sp-term" id="sp-term"></div>'
              + '<div class="sp-badge"><span class="sp-bk tl"></span><span class="sp-bk tr"></span><span class="sp-bk bl"></span><span class="sp-bk br"></span><div class="sp-glow"></div><img class="sp-wave" src="/pulsecheck-wave.svg" alt="PulseCheck" width="150" height="108"/><div class="sp-scanline"></div></div>'
              + '<div class="sp-word">Pulse<span class="os">OS</span></div>'
              + '<div class="sp-eyebrow">Command Center</div>'
              + '<div class="sp-prog"><div class="sp-track"><div id="splash-bar"></div><div class="sp-shimmer"></div></div><div class="sp-pct" id="splash-pct">000</div></div>'
              + '</div>';
            document.body.prepend(d);

            var term = document.getElementById('sp-term');
            var bootLines = [["init gateway","OK"],["mount data plane","OK"],["sync agent fleet","OK"],["calibrate telemetry","OK"],["authenticate","OK"]];
            var li = 0;
            function addLine(){
              if(!term || li>=bootLines.length) return;
              var L = bootLines[li++];
              var row = document.createElement('div');
              row.className = 'sp-line';
              row.innerHTML = '<span class="sp-k">&gt; '+L[0]+'</span><span class="sp-dots"></span><span class="sp-ok">'+L[1]+'</span>';
              term.appendChild(row);
              setTimeout(addLine, 190);
            }
            setTimeout(addLine, 220);
            var bar = document.getElementById('splash-bar');
            var pct = document.getElementById('splash-pct');
            var prog = 0;
            function spPad(n){ n=Math.round(n); return (n<10?'00':n<100?'0':'')+n; }
            var spT0 = Date.now();
            var spRamp = setInterval(function(){
              var e = (Date.now()-spT0)/1000;
              var tg = Math.min(92, Math.round(100*(1-Math.exp(-e/1.4))));
              if(tg>prog) prog=tg;
              if(bar) bar.style.width = prog+'%';
              if(pct) pct.textContent = spPad(prog);
            }, 60);

            var style = document.createElement('style');
            style.textContent = '#splash-screen .sp-aurora{position:absolute;inset:-25%;pointer-events:none;filter:blur(48px);opacity:.5;background:radial-gradient(38% 38% at 24% 28%,rgba(255,140,64,.30),transparent 60%),radial-gradient(34% 34% at 80% 22%,rgba(255,107,53,.18),transparent 60%),radial-gradient(46% 46% at 72% 84%,rgba(255,90,40,.22),transparent 62%)}#splash-screen .sp-grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,140,64,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,140,64,.05) 1px,transparent 1px);background-size:46px 46px;-webkit-mask-image:radial-gradient(circle at 50% 50%,#000,transparent 72%);mask-image:radial-gradient(circle at 50% 50%,#000,transparent 72%)}#splash-screen .sp-grain{position:absolute;inset:0;pointer-events:none;opacity:.05;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22160%22 height=%22160%22%3E%3Cfilter id=%22ns%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%224%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23ns)%22/%3E%3C/svg%3E")}#splash-screen .sp-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(125% 95% at 50% 50%,transparent 50%,rgba(0,0,0,.6))}#splash-screen .sp-stack{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center}#splash-screen .sp-term{width:300px;max-width:80vw;margin-bottom:24px;font:500 12px/1.75 ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--sp-muted)}#splash-screen .sp-line{display:flex;align-items:center;gap:8px;opacity:1}#splash-screen .sp-k{color:#9FB3CC;white-space:nowrap}#splash-screen .sp-dots{flex:1;height:1px;background:repeating-linear-gradient(90deg,rgba(255,140,64,.25) 0 2px,transparent 2px 6px)}#splash-screen .sp-ok{color:#FFB547;font-weight:600;letter-spacing:.12em}#splash-screen .sp-badge{position:relative;display:flex;align-items:center;justify-content:center;padding:14px 22px;overflow:hidden}#splash-screen .sp-bk{position:absolute;width:18px;height:18px;border:2px solid rgba(255,140,64,.55)}#splash-screen .sp-bk.tl{top:0;left:0;border-right:0;border-bottom:0}#splash-screen .sp-bk.tr{top:0;right:0;border-left:0;border-bottom:0}#splash-screen .sp-bk.bl{bottom:0;left:0;border-right:0;border-top:0}#splash-screen .sp-bk.br{bottom:0;right:0;border-left:0;border-top:0}#splash-screen .sp-wave{height:94px;width:auto;position:relative;z-index:1;filter:drop-shadow(0 8px 30px rgba(255,107,53,.40))}#splash-screen .sp-glow{position:absolute;top:50%;left:50%;width:230px;height:200px;border-radius:50%;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(255,120,40,.16),rgba(255,140,64,.05) 45%,transparent 70%);pointer-events:none;z-index:0}#splash-screen .sp-scanline{position:absolute;left:8px;right:8px;top:0;height:2px;z-index:2;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(255,140,64,.9),transparent);box-shadow:0 0 12px rgba(255,140,64,.85);opacity:0}#splash-screen .sp-word{margin-top:16px;font:700 26px/1 "Bricolage Grotesque",ui-sans-serif,system-ui,-apple-system,sans-serif;letter-spacing:.02em;color:var(--sp-txt)}#splash-screen .sp-word .os{background:linear-gradient(90deg,#E63946 0%,#FF6B35 40%,#FF9F1C 70%,#FFD166 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}#splash-screen .sp-eyebrow{margin-top:9px;font:600 10px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.34em;text-transform:uppercase;color:#7FB7C4}#splash-screen .sp-prog{margin-top:24px;display:flex;align-items:center;gap:12px}#splash-screen .sp-track{position:relative;width:200px;height:3px;border-radius:3px;overflow:hidden;background:rgba(255,140,64,.12)}#splash-screen #splash-bar{width:0%;height:100%;border-radius:3px;background:linear-gradient(90deg,#E63946,#FF6B35,#FF9F1C,#FFD166);transition:width .3s cubic-bezier(.4,0,.2,1)}#splash-screen .sp-pct{font:600 11px/1 ui-monospace,"SF Mono",Menlo,monospace;color:var(--sp-muted);min-width:30px;text-align:left}#splash-screen .sp-shimmer{position:absolute;top:0;left:-100%;width:100%;height:100%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.32),transparent)}@media (prefers-reduced-motion:no-preference){#splash-screen .sp-aurora{animation:spAurora 18s ease-in-out infinite alternate}#splash-screen .sp-glow{animation:spGlow 2.6s ease-in-out infinite}#splash-screen .sp-wave{animation:spWave 1s cubic-bezier(.2,.7,.2,1) both}#splash-screen .sp-badge{animation:spBadge .7s cubic-bezier(.2,.7,.2,1) both}#splash-screen .sp-scanline{animation:spScan 1.2s ease .85s 1 both}#splash-screen .sp-line{opacity:0;animation:spLine .3s ease forwards}#splash-screen .sp-shimmer{animation:spShimmer 1.7s ease-in-out infinite}}@keyframes spAurora{0%{transform:translate3d(-2%,-1%,0) scale(1)}100%{transform:translate3d(3%,2%,0) scale(1.08)}}@keyframes spGlow{0%,100%{opacity:.5;transform:translate(-50%,-50%) scale(1)}50%{opacity:.9;transform:translate(-50%,-50%) scale(1.1)}}@keyframes spWave{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@keyframes spBadge{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}@keyframes spScan{0%{top:0;opacity:0}12%{opacity:1}100%{top:100%;opacity:0}}@keyframes spLine{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@keyframes spShimmer{0%{left:-100%}60%,100%{left:130%}}';
            document.head.appendChild(style);

            window.__dismissSplash = function() {
              var el = document.getElementById('splash-screen');
              if (!el) return;
              try{ clearInterval(spRamp); }catch(e){}
              if (bar) bar.style.width = '100%';
              if (pct) pct.textContent = '100';
              setTimeout(function(){
                el.style.opacity = '0';
                el.style.filter = 'blur(8px)';
                el.style.transform = 'scale(1.04)';
                setTimeout(function(){ el.remove(); }, 700);
              }, 260);
            };
            // Fallback: always dismiss after 8s
            setTimeout(function(){ window.__dismissSplash && window.__dismissSplash(); }, 8000);
            // Fast dismiss: if returning user (has gateway config in localStorage), skip splash quickly
            try {
              if (localStorage.getItem('clawsuite-gateway-url') || localStorage.getItem('gateway-url')) {
                setTimeout(function(){ window.__dismissSplash && window.__dismissSplash(); }, 2000);
              }
            } catch(e) {}
          })()
        `,
          }}
        />
        <div className="root">{children}</div>
        <Scripts />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
          (function(){
            var start = Date.now();
            function check() {
              var el = document.querySelector('nav, aside, .workspace-shell, [data-testid]');
              var elapsed = Date.now() - start;
              if (el && elapsed > 2500) { window.__dismissSplash && window.__dismissSplash(); }
              else { setTimeout(check, 200); }
            }
            setTimeout(check, 2500);
          })()
        `,
          }}
        />
      </body>
    </html>
  )
}
