/**
 * /api/workspace/memory-files — enumerate local OpenClaw memory files for the
 * Skills Browser sidebar. Walks three roots, each mapped to a section:
 *   workspace -> ~/.openclaw/memory/<top-level files>
 *   project   -> ~/.openclaw/memory/projects/**
 *   agent     -> ~/.openclaw/memory/agents/**
 * Missing roots are silently treated as empty. Returns { files: MemoryFileItem[] }.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'

type MemorySection = 'workspace' | 'project' | 'agent'

type MemoryFileItem = {
  name: string
  path: string
  size: string
  section: MemorySection
}

const MAX_FILES = 500
const MAX_DEPTH = 6

function memoryRoot(): string {
  const override = process.env.OPENCLAW_MEMORY_DIR?.trim()
  if (override) return override
  return path.join(os.homedir(), '.openclaw', 'memory')
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

async function walk(
  dir: string,
  section: MemorySection,
  out: Array<MemoryFileItem>,
  depth = 0,
): Promise<void> {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, section, out, depth + 1)
      continue
    }
    if (!entry.isFile()) continue
    let size = 0
    try {
      const stat = await fs.stat(full)
      size = stat.size
    } catch {
      // ignore unreadable entries
    }
    out.push({
      name: entry.name,
      path: full,
      size: formatSize(size),
      section,
    })
  }
}

async function listMemoryFiles(): Promise<Array<MemoryFileItem>> {
  const root = memoryRoot()
  const out: Array<MemoryFileItem> = []

  // workspace section: top-level files only (skip subdirs we route below)
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (!entry.isFile()) continue
      const full = path.join(root, entry.name)
      let size = 0
      try {
        const stat = await fs.stat(full)
        size = stat.size
      } catch {
        // ignore
      }
      out.push({
        name: entry.name,
        path: full,
        size: formatSize(size),
        section: 'workspace',
      })
    }
  } catch {
    // memory root missing — empty array still valid
  }

  await walk(path.join(root, 'projects'), 'project', out)
  await walk(path.join(root, 'agents'), 'agent', out)

  out.sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section)
    return a.name.localeCompare(b.name)
  })
  return out
}

export const Route = createFileRoute('/api/workspace/memory-files')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const files = await listMemoryFiles()
          return json({ files })
        } catch (err) {
          return json(
            {
              files: [],
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
