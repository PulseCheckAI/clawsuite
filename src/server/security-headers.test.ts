import { describe, it, expect } from 'vitest'
import { join, sep } from 'node:path'
import {
  cspFor,
  matchProxyRoute,
  safeStaticPath,
  STRICT_CSP,
  GRAPHS_CSP,
  PROXY_ROUTES,
} from './security-headers.mjs'

describe('cspFor', () => {
  it('uses the strict CSP for app paths', () => {
    expect(cspFor('/dashboard')).toBe(STRICT_CSP)
    expect(cspFor('/')).toBe(STRICT_CSP)
  })
  it('relaxes the CSP only for /graphs/*', () => {
    expect(cspFor('/graphs/code')).toBe(GRAPHS_CSP)
    expect(GRAPHS_CSP).toContain('https://cdn.jsdelivr.net')
    expect(STRICT_CSP).not.toContain('https://cdn.jsdelivr.net')
  })
})

describe('matchProxyRoute (proxy SSOT)', () => {
  it('every gateway/workspace proxy route requires auth', () => {
    for (const r of PROXY_ROUTES) expect(r.auth).toBe(true)
  })
  it('matches the gateway HTTP proxy', () => {
    const r = matchProxyRoute('/api/gateway-proxy/health')
    expect(r?.prefix).toBe('/api/gateway-proxy')
    expect(r?.auth).toBe(true)
  })
  it('matches ws-gateway as a ws route', () => {
    const r = matchProxyRoute('/ws-gateway/socket')
    expect(r?.ws).toBe(true)
    expect(r?.auth).toBe(true)
  })
  it('matches the workspace daemon proxy to its own target', () => {
    expect(matchProxyRoute('/workspace-api/x')?.target).toBe('workspace-http')
  })
  it('returns null for app + SSR-API routes (not proxied)', () => {
    expect(matchProxyRoute('/dashboard')).toBeNull()
    expect(matchProxyRoute('/api/auth-check')).toBeNull()
    expect(matchProxyRoute('/assets/app.js')).toBeNull()
  })
})

describe('safeStaticPath (path-traversal guard)', () => {
  const root = join(sep, 'srv', 'app', 'dist', 'client')

  it('resolves a normal asset under the root', () => {
    expect(safeStaticPath(root, '/assets/app.js')).toBe(
      join(root, 'assets', 'app.js'),
    )
  })

  // Inputs that must be REJECTED outright (null) — not a servable file path.
  for (const p of ['/', '']) {
    it(`rejects (null): ${JSON.stringify(p)}`, () => {
      expect(safeStaticPath(root, p)).toBeNull()
    })
  }

  // Security invariant for traversal / encoded / absolute inputs: the guard
  // CONTAINS them (path.normalize collapses leading `..` under the root), so most
  // resolve to a (nonexistent) path INSIDE root rather than null. Either way the
  // result must NEVER escape clientDir. We assert escape-proofness, not null.
  const containedTraversal = [
    '/../secret',
    '/../../etc/passwd',
    '/assets/../../../etc/shadow',
    '/%2e%2e/%2e%2e/etc', // single-encoded dots
    '/%252e%252e/secret', // double-encoded dots -> literal %2e%2e after one decode
    '/%2e%2e%5c%2e%2e%5cetc%2fpasswd', // encoded ..\..\ traversal
    '/..\\..\\windows\\system32', // raw Windows separators
    '/C:/Windows/System32', // absolute Windows path injection
    '/foo/../bar',
    '/.env',
  ]
  for (const p of containedTraversal) {
    it(`never escapes the root: ${p}`, () => {
      const resolved = safeStaticPath(root, p)
      if (resolved !== null) {
        expect(resolved.startsWith(root + sep)).toBe(true)
        expect(resolved.includes(`..${sep}`)).toBe(false)
      }
    })
  }
})
