// Shared helper — call the running LinkedIn MCP via JSON-RPC streamable-HTTP.
// Mirrors the SSE-line parsing pattern from auth.start.ts so every LinkedIn
// API route can reuse it instead of re-implementing the envelope decode.

const MCP_URL = process.env.LINKEDIN_MCP_URL ?? 'http://127.0.0.1:8120/mcp'

interface McpEnvelope {
  error?: { code: number; message: string }
  result?: {
    content?: Array<{ type: string; text: string }>
    isError?: boolean
  }
}

interface McpToolInner<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string }
}

export interface McpCallSuccess<T> {
  ok: true
  data: T
}

export interface McpCallFailure {
  ok: false
  status: number
  error: string
  code?: string | number
  hint?: string
}

export type McpCallResult<T> = McpCallSuccess<T> | McpCallFailure

function parseSseLine(line: string): unknown | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  try {
    return JSON.parse(trimmed.slice('data:'.length).trim())
  } catch {
    return null
  }
}

/**
 * Call a single MCP tool. Returns a discriminated result. Never throws.
 * `timeoutMs` defaults to 30s — uploads/posts may need longer; pass higher.
 */
export async function callLinkedInMcp<T = unknown>(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<McpCallResult<T>> {
  const rpcBody = {
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  }

  let mcpResponse: Response
  try {
    mcpResponse = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(rpcBody),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `MCP unreachable at ${MCP_URL}: ${err instanceof Error ? err.message : String(err)}`,
      hint: 'Is pulseos-linkedin-mcp running with MCP_TRANSPORT=http on port 8120?',
    }
  }

  if (!mcpResponse.ok) {
    const text = await mcpResponse.text().catch(() => '')
    return {
      ok: false,
      status: 502,
      error: `MCP returned HTTP ${mcpResponse.status}`,
      hint: text.slice(0, 300),
    }
  }

  const raw = await mcpResponse.text()
  let envelope: unknown = null
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseSseLine(line)
    if (parsed) {
      envelope = parsed
      break
    }
  }
  if (!envelope) {
    try {
      envelope = JSON.parse(raw)
    } catch {
      // leave null
    }
  }

  if (!envelope || typeof envelope !== 'object') {
    return {
      ok: false,
      status: 502,
      error: 'MCP returned unparseable response',
      hint: raw.slice(0, 300),
    }
  }

  const env = envelope as McpEnvelope
  if (env.error) {
    return {
      ok: false,
      status: 502,
      error: env.error.message,
      code: env.error.code,
    }
  }

  const text = env.result?.content?.[0]?.text
  if (!text) {
    return {
      ok: false,
      status: 502,
      error: 'MCP response missing content[0].text',
    }
  }

  let inner: McpToolInner<T>
  try {
    inner = JSON.parse(text) as McpToolInner<T>
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Failed to parse MCP tool result: ${err instanceof Error ? err.message : String(err)}`,
      hint: text.slice(0, 300),
    }
  }

  if (!inner.ok || inner.data === undefined) {
    return {
      ok: false,
      status: 502,
      error: inner.error?.message ?? 'MCP tool returned ok=false',
      code: inner.error?.code,
    }
  }

  return { ok: true, data: inner.data }
}
