// Gmail (Google) OAuth2 token store. Google access tokens expire (~1 h) and
// ship a refresh_token (when access_type=offline + prompt=consent), so this
// uses the generic expiring-token store. Backed by
// `<project root>/data/gmail-oauth.json` (0600).
//
// Override path with GMAIL_OAUTH_TOKEN_PATH.
//
// Callers:
//   src/routes/api/gmail/_client.ts        — read + write (refresh-on-expiry)
//   src/routes/api/gmail/oauth.callback.ts — write after code exchange
//   src/routes/api/gmail/oauth.status.ts   — read metadata for the UI
//   src/routes/api/gmail/oauth.ts (DELETE) — delete on Disconnect

import { createOAuthTokenStore } from './oauth-token-store'

const store = createOAuthTokenStore({
  filename: 'gmail-oauth.json',
  pathEnvVar: 'GMAIL_OAUTH_TOKEN_PATH',
})

export const readToken = store.read
export const writeToken = store.write
export const deleteToken = store.delete
export const isConnected = store.isConnected
