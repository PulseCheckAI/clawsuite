// HubSpot OAuth2 token store. HubSpot access tokens expire (~30 min) and ship
// a refresh_token, so this uses the generic expiring-token store rather than
// the Postiz one. Backed by `<project root>/data/hubspot-oauth.json` (0600).
//
// Override path with HUBSPOT_OAUTH_TOKEN_PATH.
//
// Callers:
//   src/routes/api/hubspot/_client.ts        — read + write (refresh-on-expiry)
//   src/routes/api/hubspot/oauth.callback.ts — write after code exchange
//   src/routes/api/hubspot/oauth.status.ts   — read metadata for the UI
//   src/routes/api/hubspot/oauth.ts (DELETE) — delete on Disconnect

import { createOAuthTokenStore } from './oauth-token-store'

const store = createOAuthTokenStore({
  filename: 'hubspot-oauth.json',
  pathEnvVar: 'HUBSPOT_OAUTH_TOKEN_PATH',
})

export const readToken = store.read
export const writeToken = store.write
export const deleteToken = store.delete
export const isConnected = store.isConnected
