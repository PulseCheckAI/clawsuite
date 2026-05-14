# ClawSuite - Complete Architecture

**Version:** 2.0.0  
**Date:** 2026-02-06  
**Status:** Architecture Phase → Prototype Development

---

## 🎯 Vision

Transform ClawSuite from a "better ChatGPT UI" into a **complete AI agent development environment** — the VSCode for AI agents.

### Product Positioning

- **Target Audience:** Developers tired of ChatGPT's black box
- **USP:** Full transparency, local-first, file management, agent orchestration, usage tracking
- **Tagline:** "The only AI interface you'll ever need"

---

## 🏗️ Core Architecture

### Layout Structure

```
┌──────────────────────────────────────────────────────────────┐
│ Header: [Logo] ClawSuite    [Usage] [Settings] [User] │
├──────────┬──────────────────────────────────────┬────────────┤
│          │                                      │            │
│  Left    │        Main Content Area            │   Right    │
│ Sidebar  │   (Dashboard, Chat, or Tool View)   │  Sidebar   │
│          │                                      │ (Optional) │
│ - Home   │                                      │            │
│ - Chats  │                                      │ Agent View │
│ - Skills │                                      │ - Active   │
│ - Files  │                                      │ - Queue    │
│ - Term   │                                      │ - History  │
│ - Search │                                      │            │
│          │                                      │            │
└──────────┴──────────────────────────────────────┴────────────┘
```

### Technology Stack

- **Framework:** React + TanStack Router
- **State:** TanStack Query + Zustand
- **Styling:** Tailwind CSS + shadcn/ui
- **Editor:** Monaco Editor (VSCode core)
- **Terminal:** xterm.js
- **Charts:** Recharts / Chart.js
- **Build:** Vite
- **Backend:** OpenClaw Gateway API

---

## 📋 Feature Categories

### 1. **Dashboard (NEW)** 🏠

**Route:** `/dashboard`  
**Priority:** HIGH  
**Description:** Customizable widget-based home screen replacing Mission Control

**Widgets (Drag & Drop Grid):**

- 📋 **Tasks/Projects** (Mission Control data)
- 📊 **Usage Meter** (token usage, costs, limits)
- 🤖 **Active Agents** (running sub-agents, status)
- ⏰ **Time & Date** (with timezone)
- 🌤️ **Weather** (location-based)
- 💰 **Cost Tracker** (daily/weekly/monthly spend)
- 📈 **Usage Trends** (charts over time)
- 🔔 **Notifications** (system alerts, agent completions)
- 📝 **Quick Notes** (scratch pad)
- ⚡ **Quick Actions** (spawn agent, new chat, run command)
- 🐦 **X Feed** (optional, if user connects)
- 📊 **Session Stats** (messages, time, model breakdown)

**Tech:**

- Grid: `react-grid-layout` (drag & drop, responsive)
- State: Persist layout in localStorage
- Data: Pull from OpenClaw API + Mission Control JSON

**Files to Create:**

- `src/screens/dashboard/dashboard-screen.tsx`
- `src/screens/dashboard/components/widget-grid.tsx`
- `src/screens/dashboard/widgets/` (individual widgets)
- `src/screens/dashboard/hooks/use-dashboard-layout.ts`

---

### 2. **Sessions (EXISTS)** 💬

**Route:** `/chat/:sessionId`  
**Priority:** MAINTAIN  
**Status:** ✅ 90% complete

**Current Features:**

- Real-time streaming messages
- Session list with search
- File uploads
- Usage tracking
- Auto-scroll

**Planned Enhancements:**

- ⏳ Auto-rename sessions (in progress)
- ⏳ Search within chat history
- ⏳ Export chat as markdown
- ⏳ Voice input/output
- ⏳ Artifacts view (like Claude.ai)

---

### 3. **Skills Browser (NEW)** 🛠️

**Route:** `/skills`  
**Priority:** HIGH  
**Description:** Browse, install, configure installed skills + ClawdHub marketplace

**Tabs:**

1. **Installed** - Skills in `~/.openclaw/workspace/skills/`
2. **ClawdHub** - Browse 2,000+ community skills
3. **Marketplace** - Curated featured skills

**Features:**

- Skill search (by name, description, tags)
- One-click install from ClawdHub
- Skill details (README, triggers, config)
- Enable/disable skills
- Update notifications
- Custom skill upload
- Skill dependencies visualization

**Tech:**

- ClawdHub API integration (if available)
- Fallback: Parse `~/.openclaw/workspace/skills/` directory
- Install: `npx clawhub@latest install <slug>`

**Files to Create:**

- `src/screens/skills/skills-screen.tsx`
- `src/screens/skills/components/skill-card.tsx`
- `src/screens/skills/components/skill-detail-modal.tsx`
- `src/screens/skills/hooks/use-skills.ts`
- `src/screens/skills/hooks/use-clawhub.ts`

---

### 4. **File Explorer (EXISTS)** 📁

**Route:** `/files` (or sidebar panel)  
**Priority:** MAINTAIN  
**Status:** ✅ Complete

**Current Features:**

- Recursive file tree
- Monaco editor
- Upload/download
- Image preview
- Search/filter

**Planned Enhancements:**

- ⏳ Git integration (status, diff, commit)
- ⏳ Multi-file select
- ⏳ Folder operations (create, rename, delete)
- ⏳ File history (versions)

---

### 5. **Terminal (IN PROGRESS)** 🖥️

**Route:** `/terminal` (or bottom panel)  
**Priority:** HIGH  
**Status:** 🔨 Component exists, needs UI integration

**Features:**

- Integrated shell (bash/zsh)
- Multiple tabs
- Command history
- Output streaming
- Split view (horizontal/vertical)

**Integration Points:**

- Bottom panel (toggle like VSCode)
- Route: `/terminal`
- Keyboard shortcut: Ctrl+` (backtick)

**Files to Complete:**

- `src/screens/terminal/terminal-screen.tsx` (exists)
- `src/components/terminal-panel.tsx` (new)
- `src/hooks/use-terminal.ts` (new)

---

### 6. **Search (NEW)** 🔍

**Route:** `/search`  
**Priority:** MEDIUM  
**Description:** Search across all chats, files, and agents

**Search Scopes:**

- Chat history (messages, code blocks)
- Files (content + names)
- Agent sessions (transcripts)
- Skills (descriptions, code)

**Features:**

- Full-text search
- Filters (date range, session, file type)
- Jump to result in context
- Export results

**Tech:**

- Backend: OpenClaw API search endpoint (if exists)
- Fallback: Client-side search with indexing
- UI: Spotlight-style search modal (Cmd+K)

**Files to Create:**

- `src/screens/search/search-screen.tsx`
- `src/components/search-modal.tsx`
- `src/hooks/use-search.ts`

---

### 7. **Agent View (NEW)** 🤖

**Route:** Right sidebar panel  
**Priority:** HIGH  
**Description:** Monitor active sub-agents, task queue, agent history

**Sections:**

- **Active Agents** (running tasks, progress bars)
- **Queue** (pending tasks)
- **History** (completed agents, results)

**Features Per Agent:**

- Task description
- Model used
- Token usage
- Runtime
- Progress (streaming)
- Quick actions (pause, kill, inspect, restart)

**Tech:**

- Poll `/api/sessions` for sub-agent sessions
- Filter by `kind: "isolated"`
- Stream agent output in real-time

**Files to Create:**

- `src/components/agent-view/agent-view-panel.tsx`
- `src/components/agent-view/agent-card.tsx`
- `src/components/agent-view/agent-progress-bar.tsx`
- `src/hooks/use-active-agents.ts`

---

## 🔌 API Integration Strategy

### OpenClaw Gateway API Endpoints Needed

```typescript
// Existing (already integrated)
GET  /api/sessions                            // src/routes/api/sessions.ts
GET  /api/sessions/:sessionKey/status         // src/routes/api/sessions/$sessionKey.status.ts
POST /api/sessions/send                       // src/routes/api/sessions/send.ts
GET  /api/chat-events                         // src/routes/api/chat-events.ts (SSE stream)
POST /api/chat-abort                          // src/routes/api/chat-abort.ts

// New (need to implement or discover)
GET  /api/dashboard/widgets        // Widget data
GET  /api/skills                   // Installed skills
GET  /api/clawhub/search           // ClawdHub marketplace
POST /api/skills/install           // Install skill
GET  /api/agents/active            // Active sub-agents
GET  /api/search                   // Global search
GET  /api/terminal/spawn           // Create terminal session
WS   /api/terminal/:id             // Terminal I/O stream
```

### Backend Requirements

- **Mission Control Fork:** Copy task data from `skills/mission-control/data/tasks.json`
- **Skills API:** Expose installed skills from `~/.openclaw/workspace/skills/`
- **Agent Monitoring:** Filter sessions by `kind` + expose metrics
- **Terminal API:** Spawn PTY sessions, stream I/O

---

## 🎨 Design System

### Color Palette (Existing)

```css
/* Primary - Orange (OpenClaw brand) */
--primary: 15 86% 55%; /* #ea580c */
--primary-foreground: 0 0% 100%;

/* Dark theme (default) */
--background: 0 0% 8%; /* #141414 */
--foreground: 0 0% 98%;
--card: 0 0% 10%;
--border: 0 0% 20%;
```

### Layout Breakpoints

```css
/* Mobile: 375px - 767px */
/* Tablet: 768px - 1023px */
/* Desktop: 1024px+ */
/* Wide: 1440px+ (show right sidebar by default) */
```

### Component Hierarchy

```
ClawSuite (root)
├── Header
│   ├── Logo (clickable → /dashboard)
│   ├── UsageMeter
│   └── UserMenu
├── LeftSidebar
│   ├── NavMenu (Dashboard, Chats, Skills, Files, Terminal, Search)
│   └── SidebarToggle
├── MainContent
│   ├── DashboardScreen
│   ├── ChatScreen
│   ├── SkillsScreen
│   ├── FilesScreen
│   ├── TerminalScreen
│   └── SearchScreen
├── RightSidebar (collapsible)
│   └── AgentView
└── TerminalPanel (bottom, toggleable)
```

---

## 📦 Data Models

### Dashboard Widget

```typescript
interface Widget {
  id: string
  type:
    | 'tasks'
    | 'usage'
    | 'agents'
    | 'weather'
    | 'notes'
    | 'quick-actions'
    | 'cost-tracker'
    | 'x-feed'
  position: { x: number; y: number; w: number; h: number }
  config: Record<string, any> // Widget-specific settings
  enabled: boolean
}

interface DashboardLayout {
  widgets: Widget[]
  breakpoint: 'sm' | 'md' | 'lg' | 'xl'
}
```

### Agent Session

```typescript
interface AgentSession {
  sessionId: string
  agentId: string // 'codex', 'research', etc.
  task: string
  status: 'pending' | 'running' | 'complete' | 'failed'
  model: string
  startedAt: string
  completedAt?: string
  runtime?: number // seconds
  tokens?: { input: number; output: number }
  cost?: number
  progress?: number // 0-100
}
```

### Skill Metadata

```typescript
interface Skill {
  slug: string // folder name
  name: string
  description: string
  triggers: string[]
  homepage?: string
  author?: string
  version?: string
  installed: boolean
  enabled: boolean
  path: string // local file path
}
```

---

## 🚀 Development Phases

### Phase 1: Dashboard Infrastructure (Week 1)

**Goal:** Functional dashboard with 3 core widgets

**Tasks:**

1. ✅ Create dashboard route + screen component
2. ✅ Integrate `react-grid-layout` for widget grid
3. ✅ Build 3 starter widgets:
   - Tasks (Mission Control fork)
   - Usage Meter (existing component)
   - Active Agents (new)
4. ✅ Persist layout to localStorage
5. ✅ Add widget settings modal

**Deliverables:**

- Draggable widget dashboard
- Mission Control tasks visible
- Agent monitoring basic view

---

### Phase 2: Skills Browser (Week 1-2)

**Goal:** Browse and install skills

**Tasks:**

1. ✅ Create skills route + screen
2. ✅ Build skill card component
3. ✅ Integrate with local skills directory
4. ✅ Add ClawdHub search API integration
5. ✅ Implement install/uninstall flow

**Deliverables:**

- Browse installed skills
- Search ClawdHub marketplace
- One-click skill install

---

### Phase 3: Terminal Integration (Week 2)

**Goal:** Integrated terminal panel

**Tasks:**

1. ✅ Complete terminal screen component (exists)
2. ✅ Add bottom panel UI (like VSCode)
3. ✅ Connect to OpenClaw terminal API
4. ✅ Add keyboard shortcuts (Ctrl+`)
5. ✅ Support multiple tabs

**Deliverables:**

- Functional terminal panel
- Multiple terminal tabs
- Keyboard navigation

---

### Phase 4: Agent View & Search (Week 2-3)

**Goal:** Right sidebar agent monitoring + global search

**Tasks:**

1. ✅ Build agent view panel
2. ✅ Connect to `/api/sessions` for sub-agents
3. ✅ Add agent progress bars
4. ✅ Build search modal (Cmd+K)
5. ✅ Implement search across chats/files

**Deliverables:**

- Real-time agent monitoring
- Global search working
- Keyboard shortcuts enabled

---

### Phase 5: Dashboard Widgets Expansion (Week 3-4)

**Goal:** Complete widget library (8+ widgets)

**Widgets to Build:**

- ⏳ Weather (skill integration)
- ⏳ Time & Date
- ⏳ Cost Tracker (charts)
- ⏳ Quick Notes
- ⏳ Quick Actions
- ⏳ X Feed (optional)
- ⏳ Usage Trends (charts)
- ⏳ Notifications

**Deliverables:**

- 8-10 functional widgets
- Responsive grid layouts
- Widget marketplace (future)

---

### Phase 6: Polish & Launch (Week 4)

**Goal:** Production-ready release

**Tasks:**

1. ✅ Bug fixes (infinite refresh, auto-rename - IN PROGRESS)
2. ✅ Performance optimization
3. ✅ Mobile responsive testing
4. ✅ Documentation
5. ✅ Export logo assets (PNGs)
6. ✅ Deploy landing page (buildingthefuture.io)
7. ✅ X launch thread

**Deliverables:**

- Polished UI/UX
- Marketing materials ready
- Public launch on X/GitHub

---

## 🔗 Integration Points

### Mission Control Fork

**Source:** `~/.openclaw/workspace/skills/mission-control/`  
**Integration:**

- Copy `data/tasks.json` structure into Studio
- Keep Mission Control as standalone skill
- Dashboard widget pulls from same data source
- Add "Open in Mission Control" link

### ClawdHub Skill

**Source:** `~/.openclaw/workspace/skills/clawdhub/`  
**Integration:**

- Embed ClawdHub CLI functionality
- Skills browser uses ClawdHub search
- Keep skill for CLI usage
- Studio provides GUI wrapper

### Weather Skill

**Source:** `~/.openclaw/workspace/skills/weather/`  
**Integration:**

- Dashboard weather widget
- Calls weather skill script
- Cache results (5-10 min)

---

## 📊 Success Metrics

### User Acquisition (Phase 1 - 3 months)

- GitHub stars: 500+
- Discord members: 200+
- Weekly active users: 100+
- X followers: 1,000+

### Engagement

- Average session time: 30+ min
- Dashboard widgets enabled: 4+ per user
- Skills installed: 5+ per user
- Active agents spawned: 10+ per week

### Technical

- Page load time: <2s
- Terminal latency: <50ms
- Search response: <200ms
- Widget refresh: <1s

---

## 🎯 Competitive Analysis

### ChatGPT

**Strengths:** Simple, fast, mobile-friendly  
**Weaknesses:** Black box, no file access, no agent visibility  
**Our Edge:** Full transparency, local files, agent orchestration

### Cursor

**Strengths:** Great for coding, inline editing  
**Weaknesses:** VSCode-only, expensive, no general AI chat  
**Our Edge:** Unified interface, multi-model, free (self-hosted)

### Claude.ai

**Strengths:** Artifacts, projects, clean UI  
**Weaknesses:** No terminal, no file management, closed ecosystem  
**Our Edge:** Full workspace control, extensible via skills

---

## 🛠️ Technical Challenges

### 1. **Real-Time Agent Monitoring**

**Challenge:** Streaming agent progress without polling spam  
**Solution:** WebSocket connection to Gateway, server-sent events

### 2. **Widget Performance**

**Challenge:** 10+ widgets refreshing = slow dashboard  
**Solution:** Virtual grid, lazy loading, stale-while-revalidate caching

### 3. **Terminal Integration**

**Challenge:** PTY sessions in browser, security  
**Solution:** xterm.js + WebSocket tunneling to Gateway

### 4. **Skills Marketplace**

**Challenge:** ClawdHub API may not exist / rate limits  
**Solution:** Scrape GitHub openclaw/skills, cache locally, fallback

### 5. **Mobile Responsiveness**

**Challenge:** Complex layouts don't translate to mobile  
**Solution:** Adaptive layout (mobile = stacked cards, desktop = grid)

---

## 📝 Next Steps (After Architecture Approval)

1. **Create detailed component specs** for each new screen
2. **Spawn Codex agents** to build prototypes in parallel:
   - Agent 1: Dashboard infrastructure + widget grid
   - Agent 2: Skills browser + ClawdHub integration
   - Agent 3: Terminal panel integration
   - Agent 4: Agent view sidebar
   - Agent 5: Search modal + global search
   - Agent 6: Widget library (Tasks, Weather, Notes, etc.)
3. **Test with mock data** to validate UI/UX
4. **Iterate based on user feedback**
5. **Polish and launch**

---

**Open Questions:**

1. Widget priority? Which widgets are must-haves for Phase 1?
2. Skills browser: Embed ClawdHub or just link to it?
3. Terminal: Bottom panel vs. dedicated route vs. both?
4. Agent view: Always visible or hide by default?
5. X Feed widget: Worth the OAuth complexity?

---

**Estimated Timeline:**

- Architecture → Prototypes: 1 week
- Prototypes → MVP: 2 weeks
- MVP → Launch: 1 week
- **Total: 4 weeks** (with parallel Codex agents)

**Estimated Cost (via API):**

- 6 Codex agents × 200k tokens avg = 1.2M tokens
- Input: 1.2M × $1.75/M = $2.10
- Output: (assume 20% output) 240k × $14/M = $3.36
- **Total: ~$5.50** (if using API)
- **FREE if using Codex CLI via ChatGPT Pro** ✅

---

## 🎨 Logo & Branding

### Current Logo

- Orange gradient background (#ea580c → #fb923c)
- Dark terminal window with claw brackets
- Scales perfectly 16px → 512px

### Marketing Assets Needed

- Favicon (16x16, 32x32)
- PWA icons (192x192, 512x512)
- Social media preview (1200x630)
- App screenshots (for landing page)

---

**END OF ARCHITECTURE DOCUMENT**

This living document will evolve as we build. All agents should reference this before starting work.
