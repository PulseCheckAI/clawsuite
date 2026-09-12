# --- Build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

# Skip downloads a server build never needs: Playwright browsers and the
# Electron binary (Electron is a devDependency used only for desktop packaging,
# never for `vite build`).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1

# This is a pnpm project (packageManager: pnpm@11; pnpm-lock.yaml is the SSOT).
# The old package-lock.json was stale — missing current deps, pinning React 18 —
# so the previous `npm ci` could never build the image. corepack ships with
# node:22 and activates the pinned pnpm; --frozen-lockfile is the CI-safe install
# and pulls the correct alpine/musl prebuilt esbuild+lightningcss binaries from
# the cross-platform lock.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true

COPY . .
RUN pnpm run build

# --- Production dependencies (no devDependencies) ---
# pnpm --prod install with a flat (hoisted) node_modules so it copies cleanly
# into the runtime image without pnpm's symlinked virtual store. Every
# devDependency (vite, vitest, typescript, eslint, electron, tsx, jsdom,
# prettier, @types/*, web-vitals) is build/test/tooling — none imported by the
# production server (node server-entry.js) — so this trims size + attack surface
# with zero runtime impact.
FROM node:22-alpine AS prod-deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod --config.node-linker=hoisted --config.dangerouslyAllowAllBuilds=true

# --- Fetch built-in OpenClaw skills ---
FROM node:22-alpine AS skills
WORKDIR /tmp
RUN apk add --no-cache git && \
    npm install --global --ignore-scripts openclaw@latest
# Copy just the skills directory
RUN SKILLS_DIR=$(npm root -g)/openclaw/skills && \
    mkdir -p /openclaw-skills && \
    if [ -d "$SKILLS_DIR" ]; then cp -r "$SKILLS_DIR"/* /openclaw-skills/; fi

# --- Production stage ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup -S clawsuite && adduser -S clawsuite -G clawsuite

# Copy build output and package.json (for any runtime deps). node_modules comes
# from the prod-deps stage (production-only) — not the builder (which has all
# devDependencies installed for the build).
COPY --from=builder /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server-entry.js ./

# Copy built-in OpenClaw skills
COPY --from=skills /openclaw-skills ./openclaw-skills

# Expose default port
EXPOSE 3000

# Liveness probe: the server is "alive" if it answers HTTP at all — even a 401
# under password mode means the process is up and serving. We only fail on a
# connection error. Uses Node's built-in http (no curl/wget needed in alpine)
# and targets the app itself, never an external sidecar (so a down gateway
# can't mark a healthy container unhealthy).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/',r=>process.exit(0)).on('error',()=>process.exit(1))"

USER clawsuite

CMD ["node", "server-entry.js"]
