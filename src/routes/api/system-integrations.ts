import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gatewayRpc } from '../../server/gateway'

// ── /api/system-integrations ────────────────────────────────────────────────
//
// Honest-state probe for the 4 services that used to ship as hardcoded
// fallback entries on the Gateway Agents page. Each integration is checked
// against the actual filesystem / gateway state so the Mission Control
// "System Integrations" panel shows real status, not aspirational placeholders.
//
// state ∈ 'online' | 'configured' | 'not-configured' | 'unknown'
// ────────────────────────────────────────────────────────────────────────────

type IntegrationState = 'online' | 'configured' | 'not-configured' | 'unknown'

type Integration = {
  id: string
  name: string
  role: string
  state: IntegrationState
  detail: string
  color: string
}

function existsAny(paths: Array<string>): { ok: boolean; hit?: string } {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return { ok: true, hit: p }
    } catch {
      // ignore — filesystem probe failures = not present
    }
  }
  return { ok: false }
}

function probeCodex(): Integration {
  const home = os.homedir()
  const probe = existsAny([
    path.join(home, '.local', 'bin', 'codex.exe'),
    path.join(home, '.local', 'bin', 'codex'),
    path.join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
    path.join(
      home,
      'AppData',
      'Roaming',
      'npm',
      'node_modules',
      '@openai',
      'codex',
    ),
    '/usr/local/bin/codex',
  ])
  return {
    id: 'codex',
    name: 'Codex',
    role: 'Coding specialist',
    state: probe.ok ? 'configured' : 'not-configured',
    detail: probe.ok
      ? `CLI present at ${probe.hit}`
      : 'Codex CLI not detected on PATH',
    color: '#3B82F6',
  }
}

function probeDreams(): Integration {
  const home = os.homedir()
  const probe = existsAny([
    path.join(home, '.claude-dreams', 'dreams.py'),
    path.join(home, '.claude-dreams'),
  ])
  return {
    id: 'dreams',
    name: 'Memory consolidator',
    role: 'Claude Dreams service',
    state: probe.ok ? 'configured' : 'not-configured',
    detail: probe.ok
      ? `Dreams runner at ${probe.hit}`
      : '~/.claude-dreams not initialised',
    color: '#7C3AED',
  }
}

async function probeTelegram(): Promise<Integration> {
  try {
    const chs = await gatewayRpc<{ channels?: Array<{ id: string }> }>(
      'channels.list',
      {},
    )
    const list = Array.isArray(chs?.channels) ? chs!.channels : []
    const hasTelegram = list.some((c) => /telegram/i.test(c.id))
    return {
      id: 'telegram',
      name: 'Telegram gateway',
      role: 'Channel bridge',
      state: hasTelegram ? 'configured' : 'not-configured',
      detail: hasTelegram
        ? 'Telegram channel registered with OpenClaw gateway'
        : 'No Telegram channel in OpenClaw — Phase 3 not wired',
      color: '#06B6D4',
    }
  } catch {
    return {
      id: 'telegram',
      name: 'Telegram gateway',
      role: 'Channel bridge',
      state: 'unknown',
      detail: 'Gateway channels.list RPC unavailable',
      color: '#06B6D4',
    }
  }
}

async function probeOrchestrator(): Promise<Integration> {
  try {
    const res = await gatewayRpc<{
      defaultId?: string
      agents?: Array<{ id: string }>
    }>('agents.list', {})
    const defaultId = res?.defaultId ?? null
    const agents = Array.isArray(res?.agents) ? res!.agents : []
    return {
      id: 'orchestrator',
      name: 'Orchestrator',
      role: 'Gateway default agent',
      state: defaultId ? 'online' : 'unknown',
      detail: defaultId
        ? `Default agent: ${defaultId} (${agents.length} agents registered)`
        : 'No default agent reported by gateway',
      color: '#FF6B35',
    }
  } catch {
    return {
      id: 'orchestrator',
      name: 'Orchestrator',
      role: 'Gateway default agent',
      state: 'unknown',
      detail: 'Gateway agents.list RPC unavailable',
      color: '#FF6B35',
    }
  }
}

export const Route = createFileRoute('/api/system-integrations')({
  server: {
    handlers: {
      GET: async () => {
        const [telegram, orchestrator] = await Promise.all([
          probeTelegram(),
          probeOrchestrator(),
        ])
        const codex = probeCodex()
        const dreams = probeDreams()
        return json({
          ok: true,
          integrations: [orchestrator, codex, dreams, telegram],
        })
      },
    },
  },
})
