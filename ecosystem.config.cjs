// PM2 process config for ClawSuite / PulseOS dashboard on Windows.
// Vite dev server on port 3010; PM2 keeps it alive across crashes and reboots.
// Start: pm2 start ecosystem.config.cjs
// For boot persistence: install @jessety/pm2-installer (admin), then `pm2 save`.

module.exports = {
  apps: [
    {
      name: 'pulseos',
      cwd: 'C:/Users/costa/Projects/pulsecheck-ai/os/dashboard-clawsuite',
      // Invoke Vite's JS entry directly under Node — avoids the npm.cmd →
      // cmd.exe spawn chain that triggers `spawn EINVAL` under PM2 on Windows.
      script: 'node_modules/vite/bin/vite.js',
      args: 'dev --port 3010 --strictPort',
      env: {
        NODE_ENV: 'development',
      },
      // Vite handles file-watching itself; PM2 should only restart on crash.
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      // Log files under ~/.pm2/logs/.
      out_file: 'C:/Users/costa/.pm2/logs/pulseos-out.log',
      error_file: 'C:/Users/costa/.pm2/logs/pulseos-error.log',
      merge_logs: true,
      time: true,
    },
    {
      // Claude session lease snapshot sidecar.
      // Spec: docs/superpowers/specs/2026-05-18-parallel-claude-session-safety-design.md §13
      name: 'pulseos-claude-sessions-snapshot',
      cwd: 'C:/Users/costa/Projects/pulsecheck-ai',
      script: 'scripts/claude-sessions-snapshot.cjs',
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'C:/Users/costa/.pm2/logs/pulseos-claude-sessions-out.log',
      error_file: 'C:/Users/costa/.pm2/logs/pulseos-claude-sessions-error.log',
      merge_logs: true,
      time: true,
    },
    {
      // Sub-project D — LinkedIn engagement read-poller.
      // Spec: docs/superpowers/specs/2026-05-18-linkedin-read-d-design.md
      // Plan: docs/superpowers/plans/2026-05-18-linkedin-read-d.md
      name: 'pulseos-linkedin-worker',
      cwd: 'C:/Users/costa/Projects/pulsecheck-ai/os/linkedin-worker',
      script: 'dist/index.js',
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,
      // windowsHide critical on Windows so spawnSync children don't flash cmd windows
      // (memory: feedback_node_spawnsync_windowshide_on_pm2).
      windowsHide: true,
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'C:/Users/costa/.pm2/logs/pulseos-linkedin-worker-out.log',
      error_file: 'C:/Users/costa/.pm2/logs/pulseos-linkedin-worker-error.log',
      merge_logs: true,
      time: true,
    },
    {
      // @pulsecheck/linkedin-mcp — LinkedIn MCP server, HTTP transport on :8120.
      // Provides linkedin_* tools to Claude Code (config update required — see fix PR).
      // Previously ran as a stdio child of Claude Code; promoted to PulseOS PM2 for
      // lifecycle management + observability alongside pulseos-linkedin-worker.
      name: 'pulseos-linkedin-mcp',
      cwd: 'C:/Users/costa/Projects/pulsecheck-ai/main/apps/mcps/linkedin',
      script: 'dist/index.js',
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,
      windowsHide: true,
      env: {
        NODE_ENV: 'production',
        MCP_TRANSPORT: 'http',
        MCP_HTTP_PORT: '8120',
      },
      out_file: 'C:/Users/costa/.pm2/logs/pulseos-linkedin-mcp-out.log',
      error_file: 'C:/Users/costa/.pm2/logs/pulseos-linkedin-mcp-error.log',
      merge_logs: true,
      time: true,
    },
    {
      // PulseCheck's SINGLE canonical voice agent (GitHub PulseCheckAI/voice-engine).
      // A separate composable product (see voice-engine/docs/adr/0001-pulseos-integration.md):
      // PulseOS runs it as a sidecar over HTTP/WS on :8130; it CONSUMES the MCP fleet, it
      // does not fuse (GG-010). Keyless by default (local Ollama, $0).
      //   Slice 2 (real margin data): PULSECHECK_MCP_ENABLED:'1' + PULSE_PG_URL + WINDMILL_TOKEN
      //   Slice 3 (real audio):       TRANSCRIBER_PROVIDER:'deepgram' VOICE_PROVIDER:'cartesia' + vendor keys
      name: 'pulseos-voice-engine',
      cwd: 'C:/Users/costa/Projects/voice-engine',
      // Absolute miniconda python — it has the engine deps (websockets/fastapi/uvicorn)
      // AND the MCP deps (asyncpg/fastmcp) the marginops server needs. Bare 'python' is
      // not safe under the pm2 daemon's PATH.
      script: 'C:/Users/costa/miniconda3/python.exe',
      args: '-m uvicorn voice_engine.server:app --host 127.0.0.1 --port 8130',
      interpreter: 'none',
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 5000,
      windowsHide: true, // memory: feedback_node_spawnsync_windowshide_on_pm2
      env: {
        PYTHONPATH: 'C:/Users/costa/Projects/voice-engine',
        // skill-runner subprocess (npx -> tsx -> node) needs node on PATH; the daemon PATH may lack it.
        PATH: 'C:\\Users\\costa\\AppData\\Roaming\\fnm\\node-versions\\v22.22.2\\installation;C:\\Windows\\System32;C:\\Windows;' + (process.env.PATH || ''),
        LLM_PROVIDER: 'ollama',             // flip to 'anthropic' once the key has credit or WIF is set
        LLM_FALLBACK_PROVIDER: '',
        LOCAL_LLM_MODEL: 'llama3.2:latest',
        SKILLS_ENABLED: '1',
        // verified-real skill ids only (allowlist mode); plugin:skill ids are NOT in the
        // skill-runner catalog so they can't be allowlisted. See voice-engine docs/adr/0002.
        SKILL_ALLOWLIST: 'creative-director,content-humanizer,brand-voice,cli-marketman,cli-restaurant365,email-sequence,ad-campaign-best-practices,competitive-intel',
        SKILL_RUNNER_MCP_CMD: 'C:/Users/costa/AppData/Roaming/fnm/node-versions/v22.22.2/installation/npx.cmd',
        MEMORY_ENABLED: '0',
        // Data plane ON — real margin data (marginops-mcp). The server self-loads its DB
        // creds from pulsecheck-ai/main/.env, so NO secret belongs here. Absolute miniconda
        // python (asyncpg+fastmcp). max_tools=11 keeps margin_recommendations (prescription),
        // cuts the set_tenant_baseline WRITE tool (read-only posture).
        PULSECHECK_MCP_ENABLED: '1',
        PULSECHECK_AI_ROOT: 'C:/Users/costa/Projects/pulsecheck-ai',
        PULSECHECK_MCP_SERVERS: 'C:/Users/costa/miniconda3/python.exe C:\\Users\\costa\\Projects\\pulsecheck-ai\\main\\apps\\mcps\\marginops\\server.py=margin_',
        PULSECHECK_MCP_MAX_TOOLS: '11',
        // pulse-rag ("the brain") intentionally NOT added — blocked on a valid Windmill
        // token (both available tokens 401). Add a `…\pulse-rag\server.py=brain_` pair +
        // WINDMILL_TOKEN (via deploy env, never inlined) once a valid token exists.
      },
      out_file: 'C:/Users/costa/.pm2/logs/pulseos-voice-engine-out.log',
      error_file: 'C:/Users/costa/.pm2/logs/pulseos-voice-engine-error.log',
      merge_logs: true,
      time: true,
    },
  ],
}
