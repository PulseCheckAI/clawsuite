/**
 * /api/workspace/skills — list installed skills from the local OpenClaw workspace.
 *
 * Replaces the dead `/workspace-api` proxy to a never-vendored Aurora daemon.
 * Reads `~/.openclaw/workspace/skills/<id>/SKILL.md` and returns the inventory
 * the Skills Browser screen expects ({ skills: SkillItem[] }).
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

type SkillItem = {
  id: string
  name: string
  description: string
  path: string
  status: 'active'
}

function skillsRoot(): string {
  const override = process.env.OPENCLAW_SKILLS_DIR?.trim()
  if (override) return override
  return path.join(os.homedir(), '.openclaw', 'workspace', 'skills')
}

function parseFrontmatter(md: string): {
  name?: string
  description?: string
} {
  if (!md.startsWith('---')) return {}
  const end = md.indexOf('\n---', 3)
  if (end === -1) return {}
  const block = md.slice(3, end)
  const out: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

async function readSkill(root: string, id: string): Promise<SkillItem | null> {
  const dir = path.join(root, id)
  const skillFile = path.join(dir, 'SKILL.md')
  try {
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) return null
    const md = await fs.readFile(skillFile, 'utf-8').catch(() => null)
    if (md === null) return null
    const fm = parseFrontmatter(md)
    return {
      id,
      name: fm.name?.trim() || id,
      description: fm.description?.trim() || '',
      path: dir,
      status: 'active',
    }
  } catch {
    return null
  }
}

async function listSkills(): Promise<Array<SkillItem>> {
  const root = skillsRoot()
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  const results = await Promise.all(dirs.map((id) => readSkill(root, id)))
  return results
    .filter((s): s is SkillItem => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export const Route = createFileRoute('/api/workspace/skills')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const skills = await listSkills()
          return json({ skills })
        } catch (err) {
          return json(
            {
              skills: [],
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
