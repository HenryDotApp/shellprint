# shellprint

`shellprint` is a lightweight telemetry layer for the Claude Agent SDK.

It attaches to SDK hooks, captures tool calls, and emits structured audit events with:

- `tool`
- `category`
- normalized `action`
- optional Claude-provided `description`
- `duration_ms`
- full `raw` hook payload

Current default behavior:

- writes JSONL locally with zero required config
- keeps an in-memory event list
- optionally calls `onEvent(event)` for real-time handling

## What problem it solves

Claude Agent SDK tool calls are hard to use directly as a product-facing audit trail, especially for Bash.

Example:

- raw tool input: `curl -s https://api.github.com/orgs/anthropics`
- shellprint event:
  - `category`: `web_request`
  - `action`: `Ran curl against https://api.github.com/orgs/anthropics`
  - `description`: `Fetch Anthropic GitHub org info`

The goal is to give product and engineering teams something they can log, inspect, and eventually render in a UI without adding another LLM step.

## Install

This repo is currently set up as a local package, not a published npm package.

Use it from source or via your workspace tooling.

## Basic usage

Attach shellprint to your existing `query()` call:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createShellPrint } from "shellprint";

const shellprint = createShellPrint({
  jsonlPath: "./shellprint-events.jsonl",
  onEvent(event) {
    console.log(event);
  },
});

const result = query({
  prompt: "Research this deal...",
  options: {
    allowedTools: ["Bash", "Read", "Glob", "Grep"],
    permissionMode: "bypassPermissions",
    hooks: {
      PreToolUse: [shellprint.preToolMatcher],
      PostToolUse: [shellprint.postToolMatcher],
      PostToolUseFailure: [shellprint.failureMatcher],
    },
  },
});

for await (const message of result) {
  // keep your existing message handling unchanged
}

await shellprint.flush();
const events = shellprint.getEvents();
```

## Event shape

Example event:

```json
{
  "event_id": "toolu_01YVTR7cScN8ciraaiSMTnXW",
  "session_id": "b6ef44c2-98af-4afa-a403-77f5789bca29",
  "ts": "2026-03-10T01:07:04.935Z",
  "duration_ms": 177,
  "tool": "Bash",
  "category": "web_request",
  "action": "Ran curl against https://api.github.com/orgs/anthropics",
  "description": "Fetch Anthropic GitHub org info",
  "raw": {
    "hook_event_name": "PostToolUse",
    "tool_name": "Bash",
    "tool_input": {
      "command": "curl -s https://api.github.com/orgs/anthropics",
      "description": "Fetch Anthropic GitHub org info"
    }
  }
}
```

Field meaning:

- `action`: shellprint's normalized interpretation of what happened
- `description`: Claude's original tool description when present
- `raw`: original SDK payload for debugging or deeper inspection

## How to try it safely

### 1. Run the offline tests

```bash
cd /Users/heli/projects/shellprint/ts
npm test
```

This verifies:

- event generation
- `action` classification
- `description` passthrough
- duration tracking
- JSONL writing
- synthetic failure handling

### 2. Run the live package verifier

```bash
cd /Users/heli/projects/shellprint/ts
npm run verify:package
```

This runs a real Agent SDK session and prints emitted events in a human-readable format.

It also writes:

- [shellprint-live-events.jsonl](/Users/heli/projects/shellprint/ts/shellprint-live-events.jsonl)

### 3. Run the example consumer

```bash
cd /Users/heli/projects/shellprint/ts
npm run example
```

This is the closest thing to how another app would use the package.

Source:

- [example_query.ts](/Users/heli/projects/shellprint/ts/example_query.ts)

## Production rollout advice

Start simple:

1. attach the hook matchers to one existing `query()` flow
2. write JSONL locally or to a controlled writable path
3. inspect emitted events
4. only then wire `onEvent` into your app's logging or telemetry pipeline

Things to watch:

- `raw` can contain sensitive tool inputs or outputs
- `description` is SDK-provided and may vary in wording
- `action` is the stable field to build product/UI logic against
- call `await shellprint.flush()` before shutdown if you care about all writes landing

## Current scope

Included:

- Pre/Post/Failure hook integration
- JSONL sink
- `onEvent`
- in-memory event list
- normalized `action`
- optional `description`

Not included:

- redaction
- external sinks like Braintrust
- success/failure status modeling
- detail extraction from stdout/content

## Files

- [src/index.ts](/Users/heli/projects/shellprint/ts/src/index.ts)
- [src/types.ts](/Users/heli/projects/shellprint/ts/src/types.ts)
- [src/enricher.ts](/Users/heli/projects/shellprint/ts/src/enricher.ts)
- [src/hooks.ts](/Users/heli/projects/shellprint/ts/src/hooks.ts)
- [src/sinks.ts](/Users/heli/projects/shellprint/ts/src/sinks.ts)
