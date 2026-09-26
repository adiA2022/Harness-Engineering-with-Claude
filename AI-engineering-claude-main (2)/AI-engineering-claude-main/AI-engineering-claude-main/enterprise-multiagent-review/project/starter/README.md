# Enterprise Multi-Agent Code Review Orchestrator

Build a production-ready multi-agent system that automates code review using the Claude Agent SDK.

## Project Overview

This system uses multiple specialized AI agents working together to provide comprehensive code reviews:

- **Main Orchestrator** - Coordinates the review process and aggregates results
- **Code Quality Analyzer** - Identifies code smells, anti-patterns, and best practice violations
- **Test Coverage Analyzer** - Evaluates test completeness and suggests missing test cases
- **Refactoring Suggester** - Recommends architectural improvements and refactoring opportunities

## What's Provided

This starter includes the infrastructure you need:

- **Type Definitions** (`src/types/`) - Zod schemas for validation
- **Logger** (`src/utils/logger.ts`) - Winston structured logging
- **Report Generator** (`src/utils/report-generator.ts`) - Markdown/HTML/JSON report generation
- **Project Config** - `package.json`, `tsconfig.json`, `.env.example`
- **Test Skeletons** (`tests/`) - Test file structure
- **Example Skill** (`.claude/skills/`) - Sample Claude skill

## What You Need to Implement

Your tasks:

1. **Agent Definitions** (`src/agents/`)
   - Code Quality Analyzer
   - Test Coverage Analyzer
   - Refactoring Suggester

2. **Prompts** (`src/prompts/`)
   - Orchestrator prompt
   - Agent-specific prompts

3. **MCP Configuration** (`src/config/mcp.config.ts`)
   - GitHub MCP server
   - ESLint MCP server

4. **Orchestrator** (`src/orchestrator.ts`)
   - Main coordination logic
   - Agent spawning and result aggregation

5. **Main Entry Point** (`src/main.ts`)
   - CLI argument parsing
   - Environment validation
   - Report generation

6. **Error Handler** (Recommended) (`src/utils/error-handler.ts`)
   - Custom `ReviewError` class
   - Retry logic with exponential backoff
   - Timeout wrapper

7. **Rate Limiter** (Optional) (`src/utils/rate-limiter.ts`)
   - Token bucket algorithm with sliding window
   - Request and token tracking
   - Concurrent request management

## Getting Started

### Prerequisites

- Node.js 18+
- Anthropic API access (provided in Vocareum workspace) or [your own API key](https://console.anthropic.com/)
- [GitHub Personal Access Token](https://github.com/settings/tokens) (recommended - scopes: `repo`, `read:org`)

### Installation

**In Vocareum Workspace (Recommended):**

Your workspace comes pre-configured with Anthropic API credentials.

```bash
# Install dependencies from repository root (uses npm workspaces)
cd /voc/work/cd14715-claude-code-classroom
npm install

# Navigate to project and configure
cd project/starter
cp .env.example .env
```

**Local Setup:**

```bash
# Clone the repository
git clone https://github.com/udacity/cd14715-claude-code-classroom.git
cd cd14715-claude-code-classroom/project/starter

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

**In Vocareum Workspace:**
```bash
# API credentials are already in your environment - don't add them here

# Model Configuration (REQUIRED)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Project root (REQUIRED)
PROJECT_ROOT=/voc/work/cd14715-claude-code-classroom/project/starter

# GitHub Token (RECOMMENDED for higher rate limits)
# GITHUB_TOKEN=ghp_your-token-here

# Logging level (optional)
LOG_LEVEL=info
```

**Local Setup with Your Own API Key:**
```bash
# Your Anthropic API key
ANTHROPIC_API_KEY=sk-ant-your-key-here

# Model Configuration (REQUIRED)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929

# Project root (REQUIRED - update to your path)
PROJECT_ROOT=/absolute/path/to/project/starter

# GitHub Token (RECOMMENDED)
# GITHUB_TOKEN=ghp_your-token-here

# Logging level (optional)
LOG_LEVEL=info
```

### Running

```bash
# Development mode
npm run dev -- <owner> <repo> <pr-number>

# Production build
npm run build
npm start <owner> <repo> <pr-number>

# Example
npm run dev -- facebook react 12345
```

### Testing

```bash
# Run all tests
npm test

# Run specific test
npm test -- orchestrator.test.ts

# Watch mode
npm test -- --watch
```

## Key Technologies

- **Claude Agent SDK** - Multi-agent orchestration framework
- **Model Context Protocol (MCP)** - External data integration
- **Zod** - Schema validation and type safety
- **TypeScript** - Type-safe development
- **Vitest** - Testing framework
- **Winston** - Structured logging

## Success Criteria

Your implementation is complete when:

- [ ] TypeScript compiles without errors: `npm run build`
- [ ] All tests pass: `npm test`
- [ ] Can review a real PR: `npm start owner repo pr-number`
- [ ] Generates reports in at least one format (MD, HTML, JSON)
- [ ] Rate limiting prevents API throttling (Optional)
- [ ] Errors are handled gracefully (Recommended)

## Resources

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Zod Documentation](https://zod.dev/)

---

## Implementation Notes (August 2026)

> **Status: complete — submitted and passed.** `npm run build` and `npm test` clean (78 passing, 1 live test skipped by design); 9 required PR reports generated.

Environment: Windows 11, Node.js v24.18.1, npm 11.16.0, `claude-agent-sdk@0.1.55`,
model `claude-sonnet-4-5-20250929`. Run locally (not in the Vocareum workspace), using the
Udacity-provided credentials supplied through `.env` as described in the setup guide's
local-development option.

### Architecture as built

| Piece | File | Notes |
|---|---|---|
| MCP servers | `src/config/mcp.config.ts` | GitHub (`@modelcontextprotocol/server-github`, `GITHUB_TOKEN` → `GITHUB_PERSONAL_ACCESS_TOKEN`) and ESLint (`@eslint/mcp@latest`), both stdio via `npx` |
| Subagents | `src/agents/*.ts` | Three `AgentDefinition`s, all `model: 'inherit'`, all carrying the `Skill` tool; code-quality also gets `mcp__eslint__lint-files`, coverage/refactoring get `Glob`/`Grep` for cross-file discovery |
| Prompts | `src/prompts/*.prompt.ts` | Each states its focus area, severity/priority rubric, skill-invocation guidance, and the exact Zod-derived JSON shape to return |
| Orchestrator | `src/orchestrator.ts` | SDK `query()` with `agents`, `mcpServers`, `Task` in `allowedTools`, `outputFormat: { type: 'json_schema', schema: ReviewReportJSONSchema }`, and `safeParse` validation of the result |
| CLI | `src/main.ts` | Arg + auth + model validation, then three report formats into `reports/` |
| Utilities | `src/utils/error-handler.ts`, `rate-limiter.ts` | Exponential backoff with jitter, `Promise.race` timeout, 60-second sliding-window limiter |

### Required workarounds

1. **The bundled Claude Code CLI must not inherit an interactive login.** The Agent SDK
   spawns `node_modules/@anthropic-ai/claude-agent-sdk/cli.js`, and on a machine where
   Claude Code is already logged in, that CLI sends its OAuth Bearer token instead of the
   `ANTHROPIC_API_KEY` — which the Vocareum proxy rejects with
   `400 {"error":{"message":"This key was not found..."}}`, even though the same key works
   for direct SDK/curl calls. Fix (no source change): point `CLAUDE_CONFIG_DIR` at an
   isolated directory whose `.claude.json` pre-approves the environment key:

   ```json
   { "hasCompletedOnboarding": true,
     "customApiKeyResponses": { "approved": ["<last 20 chars of the API key>"], "rejected": [] } }
   ```

   `CLAUDE_CONFIG_DIR` is set in `.env`. Without both parts, the CLI either sends the wrong
   credential or blocks forever on an interactive "approve this API key?" prompt.

2. **`structured_output` is not on the `SDKResultMessage` union.** In SDK 0.1.55 the field
   exists only on the success variant, so reading it after a plain `message.type === 'result'`
   check fails to compile. Narrowed with a local cast in `orchestrator.ts`.

3. **`settingSources: ['project']` is required for skills to resolve.** The SDK does not load
   `.claude/skills/` by default; without this the `Skill` tool cannot find
   `javascript-best-practices`. `cwd` is set to `PROJECT_ROOT` for the same reason.

4. **Two pre-existing strict-mode type errors** in the provided `rate-limiter.ts`
   (`noUncheckedIndexedAccess` on `requestHistory[...]`) surface once the TODOs are
   implemented; both are guarded rather than cast away.

5. **Extensionless relative imports break the compiled build at runtime.** Three provided
   files (`src/types/index.ts`, `src/types/report-types.ts`, `src/utils/report-generator.ts`)
   imported siblings without a `.js` extension. Because the package is `"type": "module"`,
   `npm run dev` (tsx) resolves those fine and `npm run build` compiles without complaint —
   but `npm start` then dies with
   `ERR_MODULE_NOT_FOUND: Cannot find module '.../dist/types/analysis-results'`, since
   Node's ESM loader requires explicit extensions and `tsc` does not rewrite them. All
   relative imports now carry `.js`, and `node dist/main.js` runs correctly.

### Determinism: what the code computes rather than trusts

Two report fields are deliberately taken away from the model, because it produced confident
but wrong values:

- **`metadata.analyzedAt` / `metadata.duration`** — the model invented plausible timestamps
  (one report claimed a December 2025 date for an August 2026 run). The orchestrator stamps
  both from measured wall-clock values.
- **`summary.*` counters** — the model's headline numbers disagreed with its own findings
  (a report claiming 9 critical issues over file reviews containing 6; another claiming
  15 critical / 11 refactorings against an actual 13 / 8). `recomputeSummary()` derives
  `totalFiles`, `overallScore`, `criticalIssues`, `highPriorityTests`, and
  `refactoringOpportunities` from `fileReviews`, and logs a warning whenever it corrects
  the model.

The general rule: prose and judgement come from the agents; arithmetic and provenance come
from code. A reader who scrolls from the summary to the file details will always find the
two agree.

### Runtime characteristics observed

- A one-file PR takes roughly 3.5–5 minutes and spawns 3 subagent tasks; larger PRs scale
  with file count (3 tasks per reviewed file). Measured: 1 file ≈ 3.5 min, 4 files ≈ 10 min,
  and up to ~25 min for the same 4-file PR when API latency is high.
- The orchestrator's default budget is 80 turns and a **30-minute** timeout, with 2 retry
  attempts and a 50k-token rate-limiter reservation per review. The timeout started at 15
  minutes and was raised after a slow run exhausted it — worth tuning to your own latency.
- Results vary run to run: the same PR scored 85 and then 92 on two passes, and another
  surfaced 4 vs 9 critical issues. This is ordinary model sampling variance, not a defect,
  but it means a reviewer re-running the tool will not reproduce the committed numbers exactly.
- Failures degrade cleanly: reports are written only on success, so an interrupted run leaves
  any previously generated report intact rather than truncating it.
- `npm test` runs fully offline: the SDK is mocked, so no credentials or tokens are needed.

Good luck!