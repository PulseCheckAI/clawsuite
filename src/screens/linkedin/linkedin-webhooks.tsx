// LinkedIn Webhooks panel — register & monitor.
//
// Shows the operator-facing webhook URL they must paste into LinkedIn's
// developer-portal Webhooks tab, plus a (currently empty-state) recent
// events table. The actual webhook handler lives in
// src/routes/api/linkedin/webhook.ts.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight03Icon,
  Copy01Icon,
  LinkSquare01Icon,
  Notification03Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

function getWebhookUrl(): string {
  if (typeof window === 'undefined') return '/api/linkedin/webhook'
  return `${window.location.origin}/api/linkedin/webhook`
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // navigator.clipboard can fail on insecure origins; intentionally
      // surface nothing — operators copying manually is a reasonable fallback.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        borderColor: 'var(--mc-border)',
        background: copied ? 'var(--mc-emerald-soft)' : 'var(--mc-surface-2)',
        color: copied ? 'var(--mc-emerald)' : 'var(--mc-text-dim)',
        ['--tw-ring-color' as string]: 'var(--mc-cyan)',
        ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
      }}
    >
      <HugeiconsIcon icon={Copy01Icon} size={12} strokeWidth={2} />
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function LinkedInWebhooks() {
  const webhookUrl = useMemo(() => getWebhookUrl(), [])
  return (
    <div className="space-y-4">
      <section
        className="rounded-lg border p-4"
        style={{
          borderColor: 'var(--mc-border)',
          background: 'var(--mc-surface)',
        }}
      >
        <p
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: 'var(--mc-text-dimmer)' }}
        >
          Webhook URL · paste into LinkedIn developer portal → Webhooks tab
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code
            className="flex-1 truncate rounded border px-3 py-2 font-mono text-[12px]"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-bg)',
              color: 'var(--mc-text)',
            }}
            title={webhookUrl}
          >
            {webhookUrl}
          </code>
          <CopyButton value={webhookUrl} />
        </div>
        <p className="mt-3 text-[12px]" style={{ color: 'var(--mc-text-dim)' }}>
          LinkedIn will GET this URL on registration and every 2 hours to
          re-validate ownership. The endpoint signs the challenge with{' '}
          <code style={{ color: 'var(--mc-cyan)' }}>
            HMACSHA256(challengeCode, LINKEDIN_CLIENT_SECRET)
          </code>{' '}
          and replies with{' '}
          <code style={{ color: 'var(--mc-cyan)' }}>
            {'{ challengeCode, challengeResponse }'}
          </code>{' '}
          within the 3-second budget. Notifications arrive as POSTs with{' '}
          <code style={{ color: 'var(--mc-cyan)' }}>X-LI-Signature</code> — the
          route verifies in constant time, deduplicates by Notification ID, and
          acks with 2xx.
        </p>
        <p
          className="mt-3 rounded-md border px-3 py-2 text-[12px]"
          style={{
            borderColor: 'var(--mc-amber)',
            background: 'var(--mc-amber-soft)',
            color: 'var(--mc-text)',
          }}
        >
          <strong style={{ color: 'var(--mc-amber)' }}>Prereq:</strong> the
          Webhooks tab is only enabled for apps with an approved webhook use
          case. LinkedIn refuses ngrok URLs and non-HTTPS callbacks; for local
          development, expose this dashboard through a Cloudflare Tunnel or
          equivalent.
        </p>
      </section>

      <section
        className="rounded-lg border p-4"
        style={{
          borderColor: 'var(--mc-border)',
          background: 'var(--mc-surface)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <p
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{ color: 'var(--mc-text-dimmer)' }}
          >
            <HugeiconsIcon
              icon={Notification03Icon}
              size={11}
              strokeWidth={2}
            />
            Recent webhook events · live tail
          </p>
          <a
            href="https://www.linkedin.com/developers/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              color: 'var(--mc-cyan)',
              ['--tw-ring-color' as string]: 'var(--mc-cyan)',
              ['--tw-ring-offset-color' as string]: 'var(--mc-bg)',
            }}
          >
            Dev Portal{' '}
            <HugeiconsIcon
              icon={ArrowUpRight03Icon}
              size={11}
              strokeWidth={2}
            />
          </a>
        </div>
        {/* Honest empty state — the `audit.linkedin_webhook_events`
            table doesn't exist yet, so we don't fabricate rows. The
            webhook handler logs to console only (see TODO at
            src/routes/api/linkedin/webhook.ts). */}
        <div
          className="mt-3 rounded-md border border-dashed px-4 py-8 text-center font-mono text-[11px] uppercase tracking-wider"
          style={{
            borderColor: 'var(--mc-border)',
            background: 'var(--mc-surface-2)',
            color: 'var(--mc-text-dimmer)',
          }}
        >
          <p>No webhook events captured yet.</p>
          <p className="mt-1 normal-case tracking-normal">
            Audit-table persistence is a follow-up — see TODO in
            src/routes/api/linkedin/webhook.ts.
          </p>
        </div>
      </section>

      <section
        className="rounded-lg border p-4"
        style={{
          borderColor: 'var(--mc-border)',
          background: 'var(--mc-surface)',
        }}
      >
        <p
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: 'var(--mc-text-dimmer)' }}
        >
          <HugeiconsIcon icon={LinkSquare01Icon} size={11} strokeWidth={2} />
          Setup checklist
        </p>
        <ol
          className="mt-2 list-decimal space-y-1.5 pl-6 text-[12px]"
          style={{ color: 'var(--mc-text-dim)' }}
        >
          <li>
            Open LinkedIn Developer Portal → your app → Products. Confirm a
            webhook-eligible product (e.g. Lead Sync, Community Management) is
            approved.
          </li>
          <li>
            In the Webhooks tab, paste the URL above and click Validate.
            LinkedIn issues the challenge GET.
          </li>
          <li>
            Verify the entry shows <strong>Validated</strong>. Re-validation
            runs every 2 hours; 3 consecutive failures → blocked.
          </li>
          <li>
            Confirm{' '}
            <code style={{ color: 'var(--mc-cyan)' }}>
              LINKEDIN_CLIENT_SECRET
            </code>{' '}
            is set in the dashboard env (used as the HMAC key).
          </li>
        </ol>
      </section>
    </div>
  )
}
