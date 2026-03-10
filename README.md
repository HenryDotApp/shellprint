# shellprint

Lightweight telemetry for Claude Agent SDK tool calls.

`shellprint` attaches to Claude Agent SDK hooks and emits structured audit events with:

- `tool`
- `category`
- normalized `action`
- optional Claude-provided `description`
- `duration_ms`
- full `raw` hook payload

The TypeScript package lives in [ts/](/Users/heli/projects/shellprint/ts).

## Try it

```bash
cd /Users/heli/projects/shellprint/ts
npm test
npm run verify:package
npm run example
```

## Use it in an app

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
    hooks: {
      PreToolUse: [shellprint.preToolMatcher],
      PostToolUse: [shellprint.postToolMatcher],
      PostToolUseFailure: [shellprint.failureMatcher],
    },
  },
});

for await (const message of result) {
  // existing handling unchanged
}

await shellprint.flush();
```

## Docs

- Engineer guide: [ts/README.md](/Users/heli/projects/shellprint/ts/README.md)
- Example: [ts/EXAMPLE.md](/Users/heli/projects/shellprint/ts/EXAMPLE.md)
