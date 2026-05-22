# S0 Skill Execution Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `os/skill-runner` — a local TypeScript engine that lists, runs (headless `claude -p`), polls, and resumes any installed `~/.claude` skill, capturing text output and file artifacts.

**Architecture:** A pure-TS core (`os/skill-runner/src/core/`) with a mocked-spawn-testable boundary around the one impure step (spawning `claude`). A Phase-0 spike resolves _how_ to invoke a named skill headlessly before any core code is written. Phase 2 (MCP server) and Phase 3 (dashboard surface) are separate follow-on plans built on this core.

**Tech Stack:** TypeScript (ESM), Node 22, Vitest, `node:child_process`. No HTTP/MCP in this plan.

**Spec:** `docs/superpowers/specs/2026-05-20-s0-skill-execution-engine-spec.md`

---

## File Structure

```
os/skill-runner/
  package.json
  tsconfig.json
  vitest.config.ts
  src/core/
    types.ts        # Manifest, InputField, Job, StructuredError, RunInput, Artifact
    errors.ts       # makeError() helpers + ErrorType union
    frontmatter.ts  # parseSkillFrontmatter()
    discovery.ts    # discoverSkills(root) -> RawSkill[]
    overrides.ts    # curated flagship manifest overrides
    manifest.ts     # buildManifests(raws) merge defaults + overrides
    validate.ts     # validateRun(manifest, inputs, confirmHighCost)
    staging.ts      # makeJobDir(), stageFiles(), diffArtifacts()
    jobs.ts         # JobRegistry (create/get/concurrency)
    spawn.ts        # ClaudeSpawner interface + realClaudeSpawn (spike-resolved) + renderPrompt
    runner.ts       # createRunner(): listSkills/submitRun/getRun
    index.ts        # public exports
  test/             # *.test.ts (Vitest)
  docs/phase0-spike-notes.md   # produced by Phase 0
```

Each core file has one responsibility; `spawn.ts` isolates the only impure dependency so everything else is unit-testable with a fake spawner.

---

## Phase 0 — Spike (load-bearing; GATE before Phase 1)

> Not TDD — this is investigation. Output is a decision note. **If headless named-skill invocation is not reliable, STOP and revisit the approach with the user before building Phase 1.**

### Task 0: Resolve headless `claude -p` skill invocation + permission model

**Files:**

- Create: `os/skill-runner/docs/phase0-spike-notes.md`

- [ ] **Step 1: Confirm prerequisites**

Run:

```bash
claude --version
ls "$HOME/.claude/skills/creative-director/SKILL.md" "$HOME/.claude/skills/translate-book/SKILL.md"
```

Expected: a version string and both files listed. If `claude` is missing, STOP (engine is local-only and unusable here).

- [ ] **Step 2: Test named-skill invocation (text skill)**

Run (in an empty temp dir):

```bash
cd "$(mktemp -d)" && claude -p "Use the creative-director skill. Brief: a 2-line insight for a coffee brand targeting nurses on night shift." --output-format stream-json 2>spike.err | tee spike.out
echo "exit=$?"
```

Record in the notes: did Claude load+run creative-director? Was the final result in stdout? What is the stream-json shape (event types, where the final text lives)?

- [ ] **Step 3: Test a file-producing skill + permission needs**

Create a tiny test EPUB, then run translate-book headless and observe whether it can use Bash/Write without an interactive prompt. Try least-permissive first:

```bash
claude -p "Use the translate-book skill on ./test.epub, target language es." --output-format stream-json --permission-mode acceptEdits 2>>spike.err
```

Record: did it run unattended? Which permission flag was the minimum that worked? Did artifacts appear in cwd? **Do not** record `--dangerously-skip-permissions` as the answer unless nothing else works (note the risk if so).

- [ ] **Step 4: Confirm account/auth used by a non-interactive process**

Run (no TTY, simulating the PM2 server context):

```bash
claude -p "say OK" --output-format stream-json < /dev/null
```

Record: which account it authenticated as (`~/.claude` vs `~/.claude-account2`), and whether non-interactive auth works.

- [ ] **Step 5: Write the decision note**

Fill `os/skill-runner/docs/phase0-spike-notes.md` with: the exact `claude` arg array to use, the chosen permission flag + rationale, the stream-json parsing rule (how to extract final text + detect completion), the account/auth note, and a **GO / NO-GO** verdict.

- [ ] **Step 6: GATE**

If GO: proceed to Phase 1; `spawn.ts` (Task 9) uses the recorded arg array. If NO-GO: stop and bring the note to the user — the spawn approach needs rethinking (e.g., the Agent SDK instead of the CLI).

---

## Phase 1 — Core Engine (TDD; mocked spawn)

> All Phase-1 tasks except acceptance (Task 11) are invocation-agnostic: they test against a **fake spawner**, so they don't depend on the spike's exact flags.

### Task 1: Scaffold the package

**Files:**

- Create: `os/skill-runner/package.json`, `os/skill-runner/tsconfig.json`, `os/skill-runner/vitest.config.ts`, `os/skill-runner/test/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

`os/skill-runner/test/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('package', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 2: Create package files**

`package.json`:

```json
{
  "name": "@pulseos/skill-runner",
  "private": true,
  "type": "module",
  "version": "0.0.1",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 3: Install + run the test**

Run: `cd os/skill-runner && fnm use 22 && npm install && npm test`
Expected: `smoke.test.ts` PASS.

- [ ] **Step 4: Commit**

```bash
git add os/skill-runner/package.json os/skill-runner/tsconfig.json os/skill-runner/vitest.config.ts os/skill-runner/test/smoke.test.ts
git commit -m "feat(skill-runner): scaffold package"
```

### Task 2: Core types

**Files:**

- Create: `os/skill-runner/src/core/types.ts`, `os/skill-runner/test/types.test.ts`

- [ ] **Step 1: Write the failing test** (a shape guard)

`test/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Manifest, Job, StructuredError } from '../src/core/types.js'

describe('types', () => {
  it('shapes are usable', () => {
    const e: StructuredError = {
      isError: true,
      errorType: 'unknown_skill',
      message: 'x',
    }
    const j: Job = {
      id: 'j1',
      skillId: 's',
      status: 'queued',
      output: '',
      artifacts: [],
      startedAt: 0,
    }
    const m: Manifest = {
      skillId: 's',
      name: 'S',
      description: '',
      whenToUse: '',
      category: 'Productivity',
      inputs: [],
      promptTemplate: '{{input}}',
      outputType: 'text',
      costTier: 'low',
      timeoutMs: 1000,
    }
    expect([e.errorType, j.status, m.costTier]).toEqual([
      'unknown_skill',
      'queued',
      'low',
    ])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- types` → FAIL ("Cannot find module ../src/core/types.js").

- [ ] **Step 3: Write `types.ts`**

```ts
export type ErrorType =
  | 'unknown_skill'
  | 'validation_error'
  | 'claude_unavailable'
  | 'cost_gate'
  | 'spawn_failed'
  | 'timed_out'
  | 'skill_failed'
  | 'internal'
export type StructuredError = {
  isError: true
  errorType: ErrorType
  message: string
  suggestions?: string[]
}

export type InputField = {
  key: string
  label: string
  type: 'text' | 'textarea' | 'file' | 'select' | 'number'
  required: boolean
  options?: string[]
  accept?: string
  default?: unknown
}
export type Manifest = {
  skillId: string
  name: string
  description: string
  whenToUse: string
  category: string
  inputs: InputField[]
  promptTemplate: string
  outputType: 'text' | 'artifacts' | 'both'
  costTier: 'low' | 'med' | 'high'
  timeoutMs: number
}
export type Artifact = { name: string; path: string; size: number }
export type JobStatus = 'queued' | 'running' | 'done' | 'error'
export type Job = {
  id: string
  skillId: string
  status: JobStatus
  output: string
  artifacts: Artifact[]
  error?: StructuredError
  startedAt: number
}
export type RunInput = {
  skillId: string
  inputs: Record<string, unknown>
  files?: Array<{ key: string; originalName: string; tempPath: string }>
  confirmHighCost?: boolean
}
```

- [ ] **Step 4: Run the test** → PASS.
- [ ] **Step 5: Commit**: `git add os/skill-runner/src/core/types.ts os/skill-runner/test/types.test.ts && git commit -m "feat(skill-runner): core types"`

### Task 3: Frontmatter parser

**Files:**

- Create: `os/skill-runner/src/core/frontmatter.ts`, `os/skill-runner/test/frontmatter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { parseSkillFrontmatter } from '../src/core/frontmatter.js'

describe('parseSkillFrontmatter', () => {
  it('extracts name/description and strips BOM', () => {
    const md =
      '﻿---\nname: creative-director\ndescription: A creative director.\n---\n# Body'
    const fm = parseSkillFrontmatter(md)
    expect(fm.name).toBe('creative-director')
    expect(fm.description).toBe('A creative director.')
  })
  it('returns empty name when no frontmatter', () => {
    expect(parseSkillFrontmatter('# just body').name).toBe('')
  })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `frontmatter.ts` (minimal parser, same approach as `dashboard-clawsuite/src/routes/api/skills.ts`):

```ts
export type SkillFrontmatter = {
  name: string
  description: string
  homepage: string | null
  metadata: Record<string, unknown>
}

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const lines = markdown.replace(/^﻿/, '').split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  if (lines[i]?.trim() !== '---')
    return { name: '', description: '', homepage: null, metadata: {} }
  let end = i + 1
  while (end < lines.length && lines[end].trim() !== '---') end++
  const body = lines.slice(i + 1, end)
  const get = (key: string) => {
    const m = body.find((l) => l.match(new RegExp(`^${key}:\\s*`)))
    if (!m) return ''
    return m
      .replace(new RegExp(`^${key}:\\s*`), '')
      .replace(/^["']|["']$/g, '')
      .trim()
  }
  return {
    name: get('name'),
    description: get('description'),
    homepage: get('homepage') || null,
    metadata: {},
  }
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(skill-runner): frontmatter parser"`

### Task 4: Skill discovery

**Files:**

- Create: `os/skill-runner/src/core/discovery.ts`, `os/skill-runner/test/discovery.test.ts`

- [ ] **Step 1: Write the failing test** (temp fixture dir, not real `~/.claude`):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverSkills } from '../src/core/discovery.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skills-'))
  mkdirSync(join(root, 'creative-director'))
  writeFileSync(
    join(root, 'creative-director', 'SKILL.md'),
    '---\nname: creative-director\ndescription: cd\n---\nbody',
  )
  mkdirSync(join(root, 'not-a-skill'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('discoverSkills', () => {
  it('finds dirs with SKILL.md, ignores others', async () => {
    const skills = await discoverSkills(root)
    expect(skills.map((s) => s.skillId)).toEqual(['creative-director'])
    expect(skills[0].frontmatter.description).toBe('cd')
  })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `discovery.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSkillFrontmatter, type SkillFrontmatter } from './frontmatter.js'

export type RawSkill = {
  skillId: string
  folderPath: string
  frontmatter: SkillFrontmatter
  content: string
}

export async function discoverSkills(root: string): Promise<RawSkill[]> {
  const out: RawSkill[] = []
  let entries: Awaited<ReturnType<typeof readdir>> = []
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const folderPath = join(root, e.name)
    let md = ''
    try {
      md = await readFile(join(folderPath, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    out.push({
      skillId: e.name,
      folderPath,
      frontmatter: parseSkillFrontmatter(md),
      content: md,
    })
  }
  out.sort((a, b) => a.skillId.localeCompare(b.skillId))
  return out
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(skill-runner): skill discovery"`

### Task 5: Overrides + manifest build

**Files:**

- Create: `os/skill-runner/src/core/overrides.ts`, `os/skill-runner/src/core/manifest.ts`, `os/skill-runner/test/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildManifests } from '../src/core/manifest.js'
import type { RawSkill } from '../src/core/discovery.js'

const raw = (id: string, desc: string): RawSkill => ({
  skillId: id,
  folderPath: '/x/' + id,
  content: '',
  frontmatter: { name: id, description: desc, homepage: null, metadata: {} },
})

describe('buildManifests', () => {
  it('applies defaults for unknown skills', () => {
    const [m] = buildManifests([raw('random-skill', 'does things')])
    expect(m).toMatchObject({
      skillId: 'random-skill',
      outputType: 'text',
      costTier: 'low',
    })
    expect(m.inputs[0].key).toBe('input')
  })
  it('applies curated override for translate-book', () => {
    const [m] = buildManifests([raw('translate-book', 'translate')])
    expect(m.costTier).toBe('high')
    expect(m.outputType).toBe('artifacts')
    expect(m.inputs.find((i) => i.type === 'file')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `overrides.ts`:

```ts
import type { InputField } from './types.js'
type Override = {
  inputs: InputField[]
  promptTemplate: string
  outputType: 'text' | 'artifacts' | 'both'
  costTier: 'low' | 'med' | 'high'
  timeoutMs: number
}
export const OVERRIDES: Record<string, Override> = {
  'translate-book': {
    inputs: [
      {
        key: 'file',
        label: 'Book file',
        type: 'file',
        required: true,
        accept: '.epub,.docx,.pdf',
      },
      {
        key: 'target_lang',
        label: 'Target language',
        type: 'select',
        required: true,
        options: ['es', 'fr', 'de', 'zh', 'ja'],
      },
    ],
    promptTemplate:
      'Use the translate-book skill on {{file}}, target language {{target_lang}}.',
    outputType: 'artifacts',
    costTier: 'high',
    timeoutMs: 20 * 60_000,
  },
  'creative-director': {
    inputs: [
      { key: 'brief', label: 'Brief', type: 'textarea', required: true },
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        required: false,
        options: ['insight', 'big-idea', 'full'],
        default: 'full',
      },
    ],
    promptTemplate:
      'Use the creative-director skill. Mode: {{mode}}.\n\nBrief:\n{{brief}}',
    outputType: 'text',
    costTier: 'med',
    timeoutMs: 10 * 60_000,
  },
}
```

`manifest.ts`:

```ts
import type { Manifest, InputField } from './types.js'
import type { RawSkill } from './discovery.js'
import { OVERRIDES } from './overrides.js'

const DEFAULT_INPUT: InputField = {
  key: 'input',
  label: 'Input',
  type: 'textarea',
  required: true,
}

export function buildManifests(raws: RawSkill[]): Manifest[] {
  return raws.map((r) => {
    const o = OVERRIDES[r.skillId]
    return {
      skillId: r.skillId,
      name: r.frontmatter.name || r.skillId,
      description: r.frontmatter.description,
      whenToUse: r.frontmatter.description,
      category: 'Productivity',
      inputs: o?.inputs ?? [DEFAULT_INPUT],
      promptTemplate:
        o?.promptTemplate ?? `Use the ${r.skillId} skill.\n\n{{input}}`,
      outputType: o?.outputType ?? 'text',
      costTier: o?.costTier ?? 'low',
      timeoutMs: o?.timeoutMs ?? 5 * 60_000,
    }
  })
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(skill-runner): manifests + flagship overrides"`

### Task 6: Input validation + error taxonomy

**Files:**

- Create: `os/skill-runner/src/core/errors.ts`, `os/skill-runner/src/core/validate.ts`, `os/skill-runner/test/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { validateRun } from '../src/core/validate.js'
import type { Manifest } from '../src/core/types.js'

const m: Manifest = {
  skillId: 'translate-book',
  name: 'translate-book',
  description: '',
  whenToUse: '',
  category: 'x',
  inputs: [
    { key: 'file', label: 'f', type: 'file', required: true, accept: '.epub' },
  ],
  promptTemplate: '{{file}}',
  outputType: 'artifacts',
  costTier: 'high',
  timeoutMs: 1000,
}

describe('validateRun', () => {
  it('rejects missing required input', () => {
    expect(validateRun(m, {}, false)?.errorType).toBe('validation_error')
  })
  it('gates high cost without confirm', () => {
    expect(validateRun(m, { file: '/x/b.epub' }, false)?.errorType).toBe(
      'cost_gate',
    )
  })
  it('passes when confirmed', () => {
    expect(validateRun(m, { file: '/x/b.epub' }, true)).toBeNull()
  })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `errors.ts`:

```ts
import type { StructuredError, ErrorType } from './types.js'
export function makeError(
  errorType: ErrorType,
  message: string,
  suggestions?: string[],
): StructuredError {
  return {
    isError: true,
    errorType,
    message,
    ...(suggestions ? { suggestions } : {}),
  }
}
```

`validate.ts`:

```ts
import type { Manifest, StructuredError } from './types.js'
import { makeError } from './errors.js'

export function validateRun(
  manifest: Manifest,
  inputs: Record<string, unknown>,
  confirmHighCost: boolean,
): StructuredError | null {
  for (const field of manifest.inputs) {
    const v = inputs[field.key]
    if (field.required && (v === undefined || v === null || v === '')) {
      return makeError(
        'validation_error',
        `Missing required input '${field.key}'.`,
      )
    }
    if (
      field.type === 'select' &&
      v !== undefined &&
      field.options &&
      !field.options.includes(String(v))
    ) {
      return makeError(
        'validation_error',
        `Input '${field.key}' must be one of: ${field.options.join(', ')}.`,
      )
    }
  }
  if (manifest.costTier === 'high' && !confirmHighCost) {
    return makeError(
      'cost_gate',
      `Skill '${manifest.skillId}' is high-cost; set confirmHighCost: true to run.`,
    )
  }
  return null
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(skill-runner): input validation + error taxonomy"`

### Task 7: File staging + artifact diff

**Files:**

- Create: `os/skill-runner/src/core/staging.ts`, `os/skill-runner/test/staging.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { diffArtifacts } from '../src/core/staging.js'

describe('diffArtifacts', () => {
  it('lists files created after the baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'job-'))
    const before = await readdir(dir)
    writeFileSync(join(dir, 'book.epub'), 'data')
    const arts = await diffArtifacts(dir, before)
    expect(arts.map((a) => a.name)).toEqual(['book.epub'])
    expect(arts[0].size).toBe(4)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `staging.ts`:

```ts
import { readdir, stat, mkdtemp, copyFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import type { Artifact } from './types.js'

export async function makeJobDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'skill-run-'))
}

export async function stageFiles(
  jobDir: string,
  files: Array<{ key: string; originalName: string; tempPath: string }>,
): Promise<Record<string, string>> {
  const paths: Record<string, string> = {}
  for (const f of files) {
    const safeName = basename(f.originalName) // strip any path traversal
    const dest = join(jobDir, safeName)
    await copyFile(f.tempPath, dest)
    paths[f.key] = dest
  }
  return paths
}

export async function diffArtifacts(
  jobDir: string,
  before: string[],
): Promise<Artifact[]> {
  const after = await readdir(jobDir)
  const created = after.filter((n) => !before.includes(n))
  const arts: Artifact[] = []
  for (const name of created) {
    const path = join(jobDir, name)
    const s = await stat(path)
    if (s.isFile()) arts.push({ name, path, size: s.size })
  }
  return arts
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(skill-runner): file staging + artifact diff"`

### Task 8: Job registry (concurrency)

**Files:**

- Create: `os/skill-runner/src/core/jobs.ts`, `os/skill-runner/test/jobs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { JobRegistry } from '../src/core/jobs.js'

describe('JobRegistry', () => {
  it('creates and retrieves jobs', () => {
    const r = new JobRegistry(2)
    const id = r.create('creative-director')
    expect(r.get(id)?.status).toBe('queued')
  })
  it('reports capacity for concurrency gating', () => {
    const r = new JobRegistry(1)
    const id = r.create('s')
    r.markRunning(id)
    expect(r.hasCapacity()).toBe(false)
    r.finish(id, 'done', 'out', [])
    expect(r.hasCapacity()).toBe(true)
    expect(r.get(id)?.output).toBe('out')
  })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `jobs.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { Job, JobStatus, Artifact, StructuredError } from './types.js'

export class JobRegistry {
  private jobs = new Map<string, Job>()
  constructor(private maxConcurrent = 2) {}

  create(skillId: string): string {
    const id = randomUUID()
    this.jobs.set(id, {
      id,
      skillId,
      status: 'queued',
      output: '',
      artifacts: [],
      startedAt: Date.now(),
    })
    return id
  }
  get(id: string): Job | undefined {
    return this.jobs.get(id)
  }
  markRunning(id: string) {
    const j = this.jobs.get(id)
    if (j) j.status = 'running'
  }
  hasCapacity(): boolean {
    let running = 0
    for (const j of this.jobs.values()) if (j.status === 'running') running++
    return running < this.maxConcurrent
  }
  finish(
    id: string,
    status: Extract<JobStatus, 'done' | 'error'>,
    output: string,
    artifacts: Artifact[],
    error?: StructuredError,
  ) {
    const j = this.jobs.get(id)
    if (!j) return
    j.status = status
    j.output = output
    j.artifacts = artifacts
    if (error) j.error = error
  }
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(skill-runner): job registry"`

### Task 9: Spawn boundary + prompt rendering

**Files:**

- Create: `os/skill-runner/src/core/spawn.ts`, `os/skill-runner/test/spawn.test.ts`

- [ ] **Step 1: Write the failing test** (defines the injectable interface + tests pure prompt rendering; the real `claude` flags come from the Phase-0 note):

```ts
import { describe, it, expect } from 'vitest'
import { renderPrompt } from '../src/core/spawn.js'

describe('renderPrompt', () => {
  it('substitutes {{key}} placeholders', () => {
    const out = renderPrompt('Use {{skill}} on {{file}}.', {
      skill: 'translate-book',
      file: '/x/b.epub',
    })
    expect(out).toBe('Use translate-book on /x/b.epub.')
  })
  it('replaces missing keys with empty string', () => {
    expect(renderPrompt('A{{missing}}B', {})).toBe('AB')
  })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `spawn.ts` (the `ClaudeSpawner` interface keeps the runner testable; `realClaudeSpawn` ARGS come from the Phase-0 spike note):

```ts
import { execFile } from 'node:child_process'

export type SpawnResult = {
  ok: boolean
  output: string
  stderr: string
  code: number | null
}
export type ClaudeSpawner = (
  prompt: string,
  cwd: string,
  timeoutMs: number,
) => Promise<SpawnResult>

export function renderPrompt(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(values[k] ?? ''))
}

// realClaudeSpawn: ARGS + any stream parsing come from os/skill-runner/docs/phase0-spike-notes.md (Task 0).
export const realClaudeSpawn: ClaudeSpawner = (prompt, cwd, timeoutMs) =>
  new Promise((resolve) => {
    // PHASE-0: replace ARGS with the confirmed flags, e.g.
    //   ['-p', prompt, '--output-format', 'stream-json', '--permission-mode', '<confirmed>']
    const ARGS = ['-p', prompt, '--output-format', 'stream-json']
    execFile(
      'claude',
      ARGS,
      { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const e = err as NodeJS.ErrnoException | null
        if (e?.code === 'ENOENT') {
          resolve({
            ok: false,
            output: '',
            stderr: 'claude CLI not found',
            code: 127,
          })
          return
        }
        resolve({
          ok: !err,
          output: stdout ?? '',
          stderr: stderr ?? '',
          code: err ? ((err as any).code ?? 1) : 0,
        })
      },
    )
  })
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: `git commit -am "feat(skill-runner): spawn boundary + prompt rendering"`

### Task 10: Runner orchestration (public API)

**Files:**

- Create: `os/skill-runner/src/core/runner.ts`, `os/skill-runner/src/core/index.ts`, `os/skill-runner/test/runner.test.ts`

- [ ] **Step 1: Write the failing test** (end-to-end with a **fake spawner** — no real claude):

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRunner } from '../src/core/runner.js'

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'skills-'))
  mkdirSync(join(root, 'creative-director'))
  writeFileSync(
    join(root, 'creative-director', 'SKILL.md'),
    '---\nname: creative-director\ndescription: cd\n---\n',
  )
  return root
}

describe('createRunner', () => {
  it('lists skills', async () => {
    const r = createRunner({
      skillsRoot: fixtureRoot(),
      spawn: async () => ({ ok: true, output: 'x', stderr: '', code: 0 }),
    })
    const skills = await r.listSkills()
    expect(skills.map((s) => s.skillId)).toContain('creative-director')
  })
  it('rejects unknown skill', async () => {
    const r = createRunner({
      skillsRoot: fixtureRoot(),
      spawn: async () => ({ ok: true, output: '', stderr: '', code: 0 }),
    })
    const res = await r.submitRun({ skillId: 'nope', inputs: {} })
    expect('isError' in res && res.isError).toBe(true)
  })
  it('runs a skill end-to-end and captures output', async () => {
    const r = createRunner({
      skillsRoot: fixtureRoot(),
      spawn: async () => ({
        ok: true,
        output: 'INSIGHT: nurses run on caffeine and guilt.',
        stderr: '',
        code: 0,
      }),
    })
    const res = await r.submitRun({
      skillId: 'creative-director',
      inputs: { input: 'coffee for nurses' },
    })
    expect('jobId' in res).toBe(true)
    const jobId = (res as { jobId: string }).jobId
    let job = r.getRun(jobId)
    for (
      let i = 0;
      i < 50 && job?.status !== 'done' && job?.status !== 'error';
      i++
    ) {
      await new Promise((x) => setTimeout(x, 10))
      job = r.getRun(jobId)
    }
    expect(job?.status).toBe('done')
    expect(job?.output).toContain('INSIGHT')
  })
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `runner.ts`:

```ts
import { discoverSkills } from './discovery.js'
import { buildManifests } from './manifest.js'
import { validateRun } from './validate.js'
import { makeError } from './errors.js'
import { JobRegistry } from './jobs.js'
import { makeJobDir, stageFiles, diffArtifacts } from './staging.js'
import { renderPrompt, realClaudeSpawn, type ClaudeSpawner } from './spawn.js'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Manifest, Job, RunInput, StructuredError } from './types.js'

export type RunnerOptions = {
  skillsRoot?: string
  spawn?: ClaudeSpawner
  maxConcurrent?: number
}

export function createRunner(opts: RunnerOptions = {}) {
  const skillsRoot = opts.skillsRoot ?? join(homedir(), '.claude', 'skills')
  const spawn = opts.spawn ?? realClaudeSpawn
  const registry = new JobRegistry(opts.maxConcurrent ?? 2)
  let cache: Manifest[] | null = null

  async function listSkills(): Promise<Manifest[]> {
    if (!cache) cache = buildManifests(await discoverSkills(skillsRoot))
    return cache
  }
  function closest(id: string, all: Manifest[]): string[] {
    return all
      .map((m) => m.skillId)
      .filter((s) => s.includes(id) || id.includes(s))
      .slice(0, 3)
  }

  async function submitRun(
    input: RunInput,
  ): Promise<{ jobId: string } | StructuredError> {
    const skills = await listSkills()
    const manifest = skills.find((m) => m.skillId === input.skillId)
    if (!manifest)
      return makeError(
        'unknown_skill',
        `Unknown skill '${input.skillId}'.`,
        closest(input.skillId, skills),
      )
    const invalid = validateRun(
      manifest,
      input.inputs,
      input.confirmHighCost ?? false,
    )
    if (invalid) return invalid
    if (!registry.hasCapacity())
      return makeError('internal', 'Runner at capacity; retry shortly.')

    const jobId = registry.create(manifest.skillId)
    void execute(jobId, manifest, input) // fire-and-forget; poll via getRun
    return { jobId }
  }

  async function execute(jobId: string, manifest: Manifest, input: RunInput) {
    registry.markRunning(jobId)
    try {
      const jobDir = await makeJobDir()
      const before = await readdir(jobDir)
      const filePaths = input.files?.length
        ? await stageFiles(jobDir, input.files)
        : {}
      const prompt = renderPrompt(manifest.promptTemplate, {
        ...input.inputs,
        ...filePaths,
      })
      const result = await spawn(prompt, jobDir, manifest.timeoutMs)
      const artifacts = await diffArtifacts(jobDir, before)
      if (!result.ok) {
        const type = result.code === 127 ? 'claude_unavailable' : 'skill_failed'
        registry.finish(
          jobId,
          'error',
          result.output,
          artifacts,
          makeError(type, result.stderr || 'skill failed'),
        )
        return
      }
      registry.finish(jobId, 'done', result.output, artifacts)
    } catch (e) {
      registry.finish(
        jobId,
        'error',
        '',
        [],
        makeError('internal', e instanceof Error ? e.message : String(e)),
      )
    }
  }

  function getRun(jobId: string): Job | undefined {
    return registry.get(jobId)
  }

  return { listSkills, submitRun, getRun }
}
```

`index.ts`:

```ts
export { createRunner } from './core/runner.js'
export type {
  Manifest,
  Job,
  RunInput,
  StructuredError,
  Artifact,
} from './core/types.js'
```

- [ ] **Step 4: Run** → all PASS.
- [ ] **Step 5: Typecheck**: `npm run typecheck` → no errors.
- [ ] **Step 6: Commit**: `git commit -am "feat(skill-runner): runner orchestration + public API"`

### Task 11: Real acceptance (gated on Phase-0 GO + local claude)

**Files:** `os/skill-runner/scripts/accept.ts` (throwaway; delete after)

- [ ] **Step 1:** With `realClaudeSpawn`'s ARGS filled from the Phase-0 note, write `scripts/accept.ts`:

```ts
import { createRunner } from '../src/core/runner.js'
const r = createRunner()
const res = await r.submitRun({
  skillId: 'creative-director',
  inputs: { brief: 'coffee brand for night-shift nurses' },
})
if ('isError' in res) {
  console.error(res)
  process.exit(1)
}
let job = r.getRun(res.jobId)
while (job && job.status !== 'done' && job.status !== 'error') {
  await new Promise((x) => setTimeout(x, 1000))
  job = r.getRun(res.jobId)
}
console.log(job?.status, '\n', job?.output)
```

Run: `npx tsx scripts/accept.ts`. Expected: real creative output, status `done`.

- [ ] **Step 2:** Repeat for `translate-book` with a tiny `.epub` (`confirmHighCost: true`, `files: [{key:'file',...}]`); expect a `.epub`/`.pdf` artifact in the job dir. Delete `scripts/accept.ts` after.
- [ ] **Step 3: Commit** any ARGS fix to `spawn.ts`: `git commit -am "fix(skill-runner): finalize claude args from phase-0 spike"`

---

## Phase 2 & 3 — separate follow-on plans (do NOT build here)

Once Phase 1 is green:

- **Phase 2 — `skill-runner-mcp`:** wrap `createRunner()` as an MCP server exposing `list_skills`/`run_skill`/`get_skill_run`/`resume_skill_run` (schemas in north-star §5A); register with one consumer; add LLM-in-the-loop tool tests. → its own plan.
- **Phase 3 — dashboard surface:** chat `/skill` affordance or a minimal runner screen calling the core via `api/skill-run.ts`. → its own plan.

`resumeRun` is intentionally deferred to Phase 2 (needs the spike's `--resume` confirmation); Phase-1 `createRunner` returns `{ listSkills, submitRun, getRun }`.

---

## Self-Review

- **Spec coverage:** discovery+manifest (Task 4–5 ✓), interface list/submit/get (Task 10 ✓; `resume` deferred to Phase 2, noted), `claude -p` invocation (Task 0 spike + Task 9 ✓), job registry/concurrency (Task 8 ✓), per-job timeout (enforced via `execFile` `timeout` in Task 9 ✓), file I/O (Task 7 ✓), error taxonomy (Task 6 ✓), security/cost/local-only (validation Task 6 + `claude_unavailable` mapping Task 10 + `basename` traversal-strip Task 7 ✓), testing (every task ✓). MCP server (spec §10) + dashboard = Phase 2/3 follow-on plans (scope-check split).
- **Placeholder scan:** the only deferred concrete is `realClaudeSpawn` ARGS — _correctly_ gated on the Phase-0 spike (real investigation), flagged in Task 9 + Task 11, not a lazy TODO.
- **Type consistency:** `Manifest`, `Job`, `RunInput`, `StructuredError`, `Artifact`, `ClaudeSpawner`, `RawSkill`, `SkillFrontmatter` used consistently; `createRunner` returns `{ listSkills, submitRun, getRun }` in every reference; `JobRegistry.finish(id, status, output, artifacts, error?)` signature matches its Task-8 def and Task-10 calls.
