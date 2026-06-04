# PulseOS Dashboard — Production + Online Cutover Runbook

Everything below is the **owner-gated** final cutover (it needs two secrets and puts the
dashboard on the public internet). The code is ready; this is the "plug in 2 values + run" guide.

## You provide (2 values)

1. **`CLAWSUITE_PASSWORD`** — the perimeter/break-glass password (also the legacy single-password
   login). Pick a strong value; store it in `os/dashboard-clawsuite/.env` (gitignored) — never commit.
2. **Cloudflare Tunnel token** for the `pulsecheckai.app` zone (same account behind
   `postiz.` / `rsshub.pulsecheckai.app`).

## 1. Multi-user auth (optional but recommended)

```sql
-- Apply once to prod Supabase (review first):
\i migrations/0001_dashboard_users.sql
```

Create the first admin (Supabase dashboard -> Auth -> Add user), then:

```sql
update public.dashboard_users set role = 'admin' where email = 'YOU@pulsecheckai.io';
```

Set on the pm2 env (in `.env`, gitignored):

```
CLAWSUITE_PASSWORD=<your-perimeter-password>
MULTIUSER_AUTH=1
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>   # or SUPABASE_SECRET_KEYS
```

(Leave `MULTIUSER_AUTH` unset to run single-password only — both work.)

## 2. Dev -> prod build (24/7, no flashing)

The Vite-native TanStack Start build emits `dist/server/server.js` as a Web `fetch` handler that
does NOT listen, serve static assets, or proxy the gateway. The production server is **`serve.mjs`**
(repo root): it serves `dist/client/*` statics, runs the SSR/API fetch handler, replicates the
dev-server gateway proxies (`/ws-gateway` auth-gated, `/api/gateway-proxy`, `/gateway-ui`,
`/workspace-api`), and applies the hardening headers + path-scoped CSP. `package.json` `start` and
the pm2 `pulseos` app are already wired to it.

```
cd os/dashboard-clawsuite
node node_modules/vite/bin/vite.js build          # ~20-100s, emits dist/ (client + server)
```

The pm2 `pulseos` app already runs the prod server (see `ecosystem.config.cjs`):

```js
script: 'serve.mjs',
node_args: '--env-file-if-exists=.env',           // loads .env: CLAWSUITE_PASSWORD, gateway URL/token, etc.
env: { NODE_ENV: 'production', PORT: '3010' },
windowsHide: true,
```

Apply after a **code** change: rebuild, then `pm2 restart pulseos`. Apply after a **structural config**
change (script/node_args): `pm2 delete pulseos && pm2 start ecosystem.config.cjs --only pulseos`.
Verify: `curl -I http://127.0.0.1:3010` -> 200, `curl http://127.0.0.1:3010/api/auth-check` ->
`"authRequired":true`, and `pm2 jlist` shows `pulseos` online with stable uptime (prod = a single
node process, so the vite-dev orphan/flashing class is gone).

## 3. 24/7 persistence

```
pm2 save
# Windows boot persistence — resurrect the saved fleet at login:
npm install -g pm2-windows-startup && pm2-startup install && pm2 save
```

(`@jessety/pm2-installer` is a GitHub repo, NOT an npm package — `npx @jessety/...` 404s. Use
`pm2-windows-startup` for a login-trigger registry entry, or clone jessety/pm2-installer for a true
boot service. `pulseos-health-watchdog` already guards liveness.)

## 4. Online via Cloudflare Tunnel -> os.pulsecheckai.app

```
# install cloudflared if needed, then with your tunnel token:
cloudflared tunnel run --token <CF_TUNNEL_TOKEN>
# map hostname os.pulsecheckai.app -> http://127.0.0.1:3010 in the CF dashboard (or config.yml)
```

Run it under pm2 so it's part of the 24/7 fleet:

```
pm2 start cloudflared --name pulseos-tunnel -- tunnel run --token <CF_TUNNEL_TOKEN>
pm2 save
```

Then set the allowed origin so the browser device-auth/CSP accepts the domain:

```
CLAWSUITE_ALLOWED_ORIGINS=https://os.pulsecheckai.app   # (wire in auth/CSP if enforced)
```

## 5. Verify online

- `curl -I https://os.pulsecheckai.app` -> 200, behind the login.
- Anonymous request blocked; admin can log in + create users at `/users`; viewer is read-only.

## Notes

- Private-only alternative to Cloudflare: `tailscale serve https / http://127.0.0.1:3010` (tailnet only).
- Rollback: revert the `ecosystem.config.cjs` pulseos block to `vite dev` + `pm2 restart pulseos`.
