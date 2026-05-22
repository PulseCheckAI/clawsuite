// PM2-managed LightRAG server (Ollama-backed graph+vector RAG, port 9622).
// Wraps the venv console script with PYTHONUTF8=1 (fixes the Windows cp1252
// splash-screen crash). Reads its Ollama config from os/lightrag-server/.env.
//
// Run: pm2 start scripts/lightrag-server.cjs --name pulseos-lightrag

const { spawn } = require('node:child_process')
const path = require('node:path')

const dir =
  process.env.LIGHTRAG_DIR ||
  'C:\\Users\\costa\\Projects\\pulsecheck-ai\\os\\lightrag-server'
const exe = path.join(dir, '.venv', 'Scripts', 'lightrag-server.exe')
const port = process.env.LIGHTRAG_PORT || '9622'

const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }

console.log(`[lightrag] ${exe} --port ${port} (cwd=${dir})`)
const child = spawn(exe, ['--port', port], {
  cwd: dir,
  env,
  stdio: 'inherit',
  windowsHide: true,
})
child.on('exit', (code) => {
  console.log('[lightrag] exited', code)
  process.exit(code ?? 0)
})
