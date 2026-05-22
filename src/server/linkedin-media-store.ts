// In-process media store for LinkedIn composer uploads.
//
// Files are written to the OS temp dir under a per-process subdirectory so the
// MCP server (separate process on 127.0.0.1:8120) can fetch them by URL via
// our /api/linkedin/media route. Each file gets a random token; metadata is
// kept in a Map so the post route knows mime/filename when calling the MCP.
//
// Eviction: entries auto-expire after MAX_AGE_MS to avoid leaking disk. The
// store also caps total entry count at MAX_ENTRIES; the oldest are dropped
// when over the cap.

import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'

const STORE_DIR = join(tmpdir(), 'clawsuite-linkedin-media')
const MAX_AGE_MS = 60 * 60 * 1000 // 1 hour
const MAX_ENTRIES = 100

export interface MediaEntry {
  token: string
  filePath: string
  fileName: string
  mimeType: string
  byteLength: number
  createdAt: number
  // 'IMAGE' | 'VIDEO' | 'DOCUMENT' — derived from mime; the MCP upload tool
  // requires this exact enum.
  assetType: 'IMAGE' | 'VIDEO' | 'DOCUMENT'
}

const entries = new Map<string, MediaEntry>()

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true })
  }
}

function evictExpired(): void {
  const cutoff = Date.now() - MAX_AGE_MS
  for (const [token, entry] of entries) {
    if (entry.createdAt < cutoff) {
      try {
        if (existsSync(entry.filePath)) unlinkSync(entry.filePath)
      } catch {
        // best-effort cleanup
      }
      entries.delete(token)
    }
  }
}

function evictOverCap(): void {
  if (entries.size <= MAX_ENTRIES) return
  const sorted = Array.from(entries.values()).sort(
    (a, b) => a.createdAt - b.createdAt,
  )
  const removeCount = entries.size - MAX_ENTRIES
  for (let i = 0; i < removeCount; i++) {
    const e = sorted[i]
    if (!e) continue
    try {
      if (existsSync(e.filePath)) unlinkSync(e.filePath)
    } catch {
      // best-effort
    }
    entries.delete(e.token)
  }
}

export function classifyAssetType(
  mimeType: string,
): 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null {
  if (mimeType.startsWith('image/')) return 'IMAGE'
  if (mimeType.startsWith('video/')) return 'VIDEO'
  if (mimeType === 'application/pdf') return 'DOCUMENT'
  return null
}

const SAFE_NAME = /[^A-Za-z0-9._-]/g

export function storeMedia(opts: {
  bytes: Buffer
  fileName: string
  mimeType: string
}): MediaEntry {
  const assetType = classifyAssetType(opts.mimeType)
  if (!assetType) {
    throw new Error(`Unsupported mime type: ${opts.mimeType}`)
  }
  ensureDir()
  evictExpired()

  const token = randomBytes(16).toString('hex')
  const sanitized =
    opts.fileName.replace(SAFE_NAME, '_').slice(0, 120) || 'file'
  const filePath = join(STORE_DIR, `${token}-${sanitized}`)
  writeFileSync(filePath, opts.bytes)

  const entry: MediaEntry = {
    token,
    filePath,
    fileName: sanitized,
    mimeType: opts.mimeType,
    byteLength: opts.bytes.byteLength,
    createdAt: Date.now(),
    assetType,
  }
  entries.set(token, entry)
  evictOverCap()
  return entry
}

export function getMedia(token: string): MediaEntry | null {
  evictExpired()
  return entries.get(token) ?? null
}

export function removeMedia(token: string): boolean {
  const entry = entries.get(token)
  if (!entry) return false
  try {
    if (existsSync(entry.filePath)) unlinkSync(entry.filePath)
  } catch {
    // best-effort
  }
  return entries.delete(token)
}
