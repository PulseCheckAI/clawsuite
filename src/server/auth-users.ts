// ── Multi-user auth layer (Supabase Auth) ───────────────────────────────────
// ADDITIVE + FLAG-GATED. Inert unless MULTIUSER_AUTH=1 AND a service-role key is
// configured. When off, the legacy single shared-password flow (auth-middleware
// + /api/auth) is the only auth path and is completely unaffected.
//
// When on: users log in with their own email + password (verified by Supabase
// Auth). There is a SINGLE role — admin. Every dashboard account is an admin;
// only admins exist, and only admins can create/disable other users.
//
// Sessions reuse the same opaque cookie token issued by auth-middleware; this
// module keeps a parallel token→user map so isAuthenticated() still gates access
// while getSessionUser() resolves identity for the admin-only surface.
// ────────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
} from '../lib/supabase-constants'
import { getSessionTokenFromCookie } from './auth-middleware'

// Single role by design — every dashboard account is an admin.
export type DashboardRole = 'admin'

export interface SessionUser {
  userId: string
  email: string
  role: DashboardRole
  orgId: string | null
}

// Mirrors auth-middleware TOKEN_TTL_MS so the identity record expires with the cookie.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const sessionUsers = new Map<string, { user: SessionUser; expiresAt: number }>()

function serviceRoleKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEYS ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    undefined
  )
}

/** Multi-user auth is active only when explicitly enabled AND admin creds exist. */
export function isMultiUserEnabled(): boolean {
  return process.env.MULTIUSER_AUTH === '1' && Boolean(serviceRoleKey())
}

// Service-role client for admin ops. Server-only; never expose to the browser.
let adminClient: SupabaseClient | undefined
function admin(): SupabaseClient {
  if (adminClient) return adminClient
  const key = serviceRoleKey()
  if (!key) throw new Error('multi-user auth: service-role key not configured')
  adminClient = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  })
  return adminClient
}

interface Profile {
  role: DashboardRole
  orgId: string | null
  disabled: boolean
}

async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await admin()
    .from('dashboard_users')
    .select('role, org_id, disabled')
    .eq('id', userId)
    .maybeSingle()
  if (error || !data) return null
  return {
    role: 'admin',
    orgId: ((data as any).org_id as string | null) ?? null,
    disabled: Boolean((data as any).disabled),
  }
}

/**
 * Verify email + password via Supabase Auth using a throwaway anon client (so we
 * never persist the user's Supabase session — we mint our own opaque cookie via
 * auth-middleware). Returns the resolved SessionUser or null on failure/disabled.
 */
export async function verifyUserCredentials(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.user) return null
  const profile = await getProfile(data.user.id)
  if (!profile || profile.disabled) return null
  return {
    userId: data.user.id,
    email: data.user.email ?? email,
    role: profile.role,
    orgId: profile.orgId,
  }
}

/** Admin: create an auth user + its dashboard_users profile row. */
export async function createUser(input: {
  email: string
  password: string
  orgId?: string | null
}): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const a = admin()
  const { data, error } = await a.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  })
  if (error || !data.user) {
    return { ok: false, error: error?.message ?? 'createUser failed' }
  }
  const { error: pErr } = await a.from('dashboard_users').insert({
    id: data.user.id,
    email: input.email,
    role: 'admin',
    org_id: input.orgId ?? null,
    disabled: false,
  })
  if (pErr) return { ok: false, error: pErr.message }
  return { ok: true, userId: data.user.id }
}

export interface UserRow {
  id: string
  email: string
  role: DashboardRole
  orgId: string | null
  disabled: boolean
  createdAt: string | null
}

export async function listUsers(): Promise<UserRow[]> {
  const { data, error } = await admin()
    .from('dashboard_users')
    .select('id, email, role, org_id, disabled, created_at')
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return (data as any[]).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    orgId: r.org_id,
    disabled: Boolean(r.disabled),
    createdAt: r.created_at,
  }))
}

export async function setUserDisabled(
  userId: string,
  disabled: boolean,
): Promise<boolean> {
  const { error } = await admin()
    .from('dashboard_users')
    .update({ disabled })
    .eq('id', userId)
  return !error
}

// ── Session identity store (keyed by the auth-middleware opaque token) ────────
export function attachSessionUser(token: string, user: SessionUser): void {
  sessionUsers.set(token, { user, expiresAt: Date.now() + SESSION_TTL_MS })
}

export function getSessionUser(token: string | null): SessionUser | null {
  if (!token) return null
  const e = sessionUsers.get(token)
  if (!e) return null
  if (Date.now() > e.expiresAt) {
    sessionUsers.delete(token)
    return null
  }
  return e.user
}

export function clearSessionUser(token: string): void {
  sessionUsers.delete(token)
}

/** Resolve the logged-in dashboard user from the request cookie (multi-user mode). */
export function getRequestUser(request: Request): SessionUser | null {
  const token = getSessionTokenFromCookie(request.headers.get('cookie'))
  return getSessionUser(token)
}

/**
 * User management (create / list / disable users) is ADMIN-ONLY.
 * The Users API routes MUST gate every mutation + the user list behind this.
 */
export function canManageUsers(user: SessionUser | null): boolean {
  return user?.role === 'admin'
}

/** Convenience guard for route handlers: returns the admin user or null. */
export function requireAdmin(request: Request): SessionUser | null {
  const user = getRequestUser(request)
  return canManageUsers(user) ? user : null
}

/** Admin accounts get the full OpenClaw operator scopes (gateway connect + UI gating). */
export function scopesForRole(_role: DashboardRole): string[] {
  return [
    'operator.read',
    'operator.write',
    'operator.admin',
    'operator.pairing',
    'operator.approvals',
  ]
}
