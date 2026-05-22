// PM2-managed Ollama with GPU (Blackwell RTX 5060, cuda_v13) + sane context.
// The tray app launches CPU-only and forces a 256K context (→ load failures /
// CPU fallback); this wrapper runs `ollama serve` DIRECTLY with the correct env
// so GPU acceleration persists across reboots. See memory
// reference_ollama_gpu_blackwell_fix (addendum 2026-05-21).
//
// Run: pm2 start scripts/ollama-gpu.cjs --name pulseos-ollama-gpu
// NOTE: disable the Ollama tray-app autostart, or it will fight for :11434.

const { spawn } = require('node:child_process')

const exe =
  process.env.OLLAMA_EXE ||
  'C:\\Users\\costa\\AppData\\Local\\Programs\\Ollama\\ollama.exe'

const env = {
  ...process.env,
  OLLAMA_LLM_LIBRARY: 'cuda_v13', // Blackwell sm_120 needs cuda_v13, not cuda_v12
  OLLAMA_CONTEXT_LENGTH: process.env.OLLAMA_CONTEXT_LENGTH || '8192',
}

console.log(
  `[ollama-gpu] ${exe} serve (cuda_v13, ctx=${env.OLLAMA_CONTEXT_LENGTH})`,
)
const child = spawn(exe, ['serve'], {
  env,
  stdio: 'inherit',
  windowsHide: true,
})
child.on('exit', (code) => {
  console.log('[ollama-gpu] exited', code)
  process.exit(code ?? 0)
})
