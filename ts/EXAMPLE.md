# Example Usage

Run the example consumer:

```bash
cd /Users/heli/projects/shellprint/ts
npm run example
```

What it does:

- creates a `shellprint` instance with default hook matchers
- runs a real Agent SDK `query()`
- logs each emitted event through `onEvent`
- writes JSONL output to [shellprint-example-events.jsonl](/Users/heli/projects/shellprint/ts/shellprint-example-events.jsonl)

Main example file:

- [example_query.ts](/Users/heli/projects/shellprint/ts/example_query.ts)

Core integration pattern:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createShellPrint } from "./src/index.js";

const shellprint = createShellPrint({
  jsonlPath: "./shellprint-example-events.jsonl",
  onEvent(event) {
    console.log(event.action, event.description);
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
const events = shellprint.getEvents();
```
