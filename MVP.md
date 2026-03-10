# shellprint MVP

## What it is

A TypeScript package that hooks into the Claude Agent SDK, captures every tool call, and produces structured, human-readable audit events. Works out of the box with zero config — writes to a local JSONL file. Optional sinks (Braintrust, callbacks) added later.

## The problem

MCP/tool calls are self-describing — `search_linkedin({name: "John Smith"})` is easy to log and show to an end user. Bash commands are opaque — `curl -s 'https://api.linkedin.com/v2/people?q=John+Smith' | python3 -c "import json, sys..."` means nothing to a broker.

The Agent SDK has no built-in telemetry. [Open GitHub issue](https://github.com/anthropics/claude-agent-sdk-typescript/issues/82) confirms the gap.

## The cheat code

Claude sends a `description` field with Bash tool calls explaining what it does in plain English. shellprint preserves that as an optional `description` field, but its normalized field is `action`, which is derived deterministically from the tool input. No extra LLM calls needed.

Fallback if description is empty: `action` still comes from command parsing (first recognizable token + arguments).

## Integration — works with `query()` directly

In the TypeScript Agent SDK, hooks work with `query()` out of the box. No workarounds needed.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createShellPrint } from "shellprint";

const sp = createShellPrint();

const result = query({
  prompt: "Research this deal...",
  options: {
    allowedTools: ["Bash", "Read", "Glob", "Grep"],
    permissionMode: "bypassPermissions",
    hooks: {
      PreToolUse: [sp.preToolMatcher],
      PostToolUse: [sp.postToolMatcher],
      PostToolUseFailure: [sp.failureMatcher],
    },
  },
});

for await (const message of result) {
  // existing message handling — unchanged
}

// After session: get all events
const events = sp.getEvents();
```

Users with existing hooks just add shellprint's matchers alongside their own:

```typescript
hooks: {
  PreToolUse: [sp.preToolMatcher, ...myOtherMatchers],
  PostToolUse: [sp.postToolMatcher, myLoggingMatcher],
  PostToolUseFailure: [sp.failureMatcher],
}
```

## Verified hook payload structure

From `hook_payloads.json` (captured from a real TS Agent SDK session, 11 payloads):

**Every hook payload includes:**
- `session_id`, `cwd`, `tool_name`, `tool_use_id`, `permission_mode`, `transcript_path`

**Bash** — PreToolUse: `tool_input.command` + `tool_input.description`. PostToolUse adds `tool_response.stdout`, `tool_response.stderr`, `tool_response.interrupted`. No exit code field.

**Grep** — `tool_input.pattern`, `tool_input.glob`, `tool_input.output_mode`. Response: `tool_response.content`, `tool_response.numLines`, `tool_response.numFiles`.

**Read** — `tool_input.file_path`. Response: `tool_response.file.filePath`, `tool_response.file.content`, `tool_response.file.numLines`.

## What it produces

Every tool call emits a single event with an enrichment layer on top of the raw payload:

```json
{
  "event_id": "toolu_01MM1inWz8pt7cuxMLh3QiGQ",
  "session_id": "e6a4e1bd-...",
  "ts": "2026-03-07T14:22:01Z",
  "duration_ms": 229,
  "category": "web_request",
  "description": "Fetch Anthropic's GitHub org info",
  "action": "Ran curl against https://api.github.com/orgs/anthropics",
  "tool": "Bash",
  "raw": { /* full hook payload as-is */ }
}
```

- `category`, `action`, `tool`, `duration_ms` — the normalized enrichment. Useful for a broker UI.
- `description` — optional passthrough of `tool_input.description` when the SDK provides it. Useful when the caller wants Claude's original wording in addition to shellprint's normalized `action`.
- `raw` — the complete PostToolUse hook payload, unmodified. Useful for developer debugging.

No `status` or `detail` in v0 — can't reliably detect success/failure without exit codes, and detail extraction is guesswork without knowing what the UI needs. Add both once the friend says what he wants to show.

## All tools, not just Bash

| Tool | Category | Action source |
|------|----------|----------------|
| Bash | Regex classifier on command | Command-derived normalized action |
| Read | `file_read` | `"Read {file_path}"` |
| Grep | `content_search` | `"Searched for '{pattern}' in {glob/path}"` |
| Edit | `file_edit` | `"Edited {file_path}"` |
| Glob | `file_search` | `"Searched for {pattern}"` |

## Category classifier

Deterministic regex for Bash commands:

```typescript
const PATTERNS: [RegExp, string][] = [
  [/curl|wget|http|fetch/,            "web_request"],
  [/python|node|ruby/,                "computation"],
  [/grep|awk|sed|cat|head|tail/,      "file_read"],
  [/git\s+(push|pull|commit|clone)/,  "version_control"],
  [/psql|mysql|sqlite|mongo/,         "database"],
  [/docker|kubectl|terraform/,        "infrastructure"],
  [/npm|pip|cargo|brew/,              "package_mgmt"],
  [/mkdir|cp|mv|rm|touch/,            "file_system"],
];
```

## Event lifecycle

- **PreToolUse**: internal only — captures start timestamp, keyed by `tool_use_id`
- **PostToolUse / PostToolUseFailure**: emits the event (raw + parsed), computes `duration_ms` from stored Pre timestamp
- `onEvent` callback fires on Post/Failure only

Duration tracking: `Map<string, number>` — store timestamp on Pre, compute delta on Post, delete entry.

## v0 scope

### In
- Hook PreToolUse / PostToolUse / PostToolUseFailure for all tools
- Capture full hook payload + enrichment (category, action, optional description, duration)
- Duration via Pre/Post timestamp correlation
- Category classifier (regex for Bash, tool name for others)
- Normalized `action` from command parsing (Bash) or tool inputs (other tools)
- Optional top-level `description` passthrough from `tool_input.description` when present
- Write events to JSONL
- In-memory event list with `getEvents()`
- `onEvent` callback for real-time use
- Composable matchers (user adds alongside their own hooks)

### Out (add if v0 validates)
- `status` detection (success/failure)
- `detail` extraction from stdout/response content
- Braintrust sink
- Secret redaction
- File reference resolution
- npm publishing

## Package structure

```
shellprint/
├── index.ts        # createShellPrint(), preToolMatcher, postToolMatcher, failureMatcher, getEvents()
├── hooks.ts        # PreToolUse / PostToolUse / PostToolUseFailure handlers, duration tracking
└── enricher.ts     # category classifier, action extraction
```

~150 lines. One dependency: `@anthropic-ai/claude-agent-sdk`.

## Build sequence

| Step | What |
|------|------|
| ~~1~~ | ~~Verify hooks~~ — **DONE.** Hooks work with `query()` directly in TS. Payload structure captured. |
| ~~2~~ | ~~Save fixtures~~ — **DONE.** `hook_payloads.json` has 11 payloads covering Bash, Grep, Read. |
| 3 | Build enricher against fixtures (category + action). Offline, free. |
| 4 | Wire together: hooks → enricher → JSONL + onEvent callback. |
| 5 | Hand JSONL to friend: "is this useful for your broker UI?" |
| 6 | If yes → add Braintrust sink, redaction, polish. |

## Risks

1. **Anthropic ships native OTEL** — raw logging becomes redundant, enrichment layer still has value.
2. **`description` unreliable for some use cases** — fallback to command parsing, quality drops.
3. **Hook API changes** — SDK is pre-1.0. Mitigated by keeping the package tiny.
