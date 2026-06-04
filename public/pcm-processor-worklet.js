// ── pcm-processor-worklet.js ───────────────────────────────────────────────
// AudioWorklet processor that downsamples Float32 mic audio from the
// AudioContext's native sample rate (typically 48 kHz on desktop browsers,
// 44.1 kHz on some mobile) to **24 kHz linear16 PCM** — the wire format
// xAI Grok Voice expects when input_audio_format == "linear16".
//
// Loaded from: GrokChatSurface.tsx via audioContext.audioWorklet.addModule
//              ('/pcm-processor-worklet.js')
//
// Wire shape posted to main thread:
//   port.postMessage({ kind: 'pcm', samples: Int16Array }, [transfer])
// The main thread base64-encodes (in chunks to avoid stack overflow) and
// publishes as `{type:"input_audio_buffer.append", audio:<base64>}` over
// the xAI WS.
//
// Reusable by future agents: hume-evi-agent's browser surface could swap
// from the SDK to a raw WS via this same worklet — the wire shape is
// identical.
// ───────────────────────────────────────────────────────────────────────────

const TARGET_SAMPLE_RATE = 24000

class PcmDownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // sampleRate is a global magic in AudioWorkletGlobalScope.
    this._inputRate = sampleRate
    this._ratio = this._inputRate / TARGET_SAMPLE_RATE
    this._phase = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channelData = input[0]
    if (!channelData || channelData.length === 0) return true

    // Linear-interpolation downsample. Good enough for speech; we'd reach
    // for a polyphase filter only if voice quality complaints materialize.
    const outLen = Math.floor((channelData.length - this._phase) / this._ratio)
    if (outLen <= 0) {
      // Carry phase forward so we don't drop samples on short input frames.
      this._phase -= channelData.length
      return true
    }
    const out = new Int16Array(outLen)
    let outIdx = 0
    let i = this._phase
    while (outIdx < outLen && i < channelData.length - 1) {
      const idx = Math.floor(i)
      const frac = i - idx
      const sample = channelData[idx] * (1 - frac) + channelData[idx + 1] * frac
      // Clamp to [-1, 1] then scale to int16.
      const clipped = Math.max(-1, Math.min(1, sample))
      out[outIdx++] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff
      i += this._ratio
    }
    // Remember where to start next chunk relative to the start of the
    // next input frame (input frames are 128 samples on most engines).
    this._phase = i - channelData.length

    // Transfer the underlying buffer to avoid a copy.
    this.port.postMessage({ kind: 'pcm', samples: out }, [out.buffer])
    return true
  }
}

registerProcessor('pcm-downsample-processor', PcmDownsampleProcessor)
