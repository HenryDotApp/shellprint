# shellprint Architecture

## Goal

Build a very small TypeScript package that converts Claude Agent SDK tool-hook payloads into broker-readable audit events with:

- zero required config
- deterministic enrichment
- raw payload preservation
- low coupling to the SDK

The package should stay small enough that hook API drift is easy to absorb.

## Design Principles

- Treat the SDK hook payload as the source of truth.
- Keep enrichment pure and deterministic.
- Keep I/O behind a tiny sink interface.
- Never require wrapping `query()` or altering the caller's message loop.
- Do not infer fields the SDK cannot support reliably in v0.

## Public API

```ts
import { createShellPrint } from "shellprint";

const sp = createShellPrint({
  jsonlPath: "./shellprint-events.jsonl",
  onEvent: (event) => {},
});

const result = query({
  prompt,
  options: {
    hooks: {
      PreToolUse: [sp.preToolMatcher],
      PostToolUse: [sp.postToolMatcher],
      PostToolUseFailure: [sp.failureMatcher],
    },
  },
});

const events = sp.getEvents();
await sp.flush();
```

### Factory return shape

- `preToolMatcher`
- `postToolMatcher`
- `failureMatcher`
- `getEvents(): ShellPrintEvent[]`
- `flush(): Promise<void>`

`flush()` is not required by the MVP doc, but it closes the only meaningful correctness gap in file output: callers need a way to wait for queued JSONL writes before process exit.

`getEvents()` should return a shallow copy so callers cannot mutate the internal event store.

## Event Model

```ts
type ShellPrintEvent = {
  event_id: string;
  session_id: string;
  ts: string;
  duration_ms?: number;
  category: ShellPrintCategory;
  description?: string;
  action: string;
  tool: string;
  raw: PostToolUseHookInput | PostToolUseFailureHookInput;
};
```

### Notes

- `event_id` is the SDK `tool_use_id`.
- `ts` is the completion timestamp, not the start timestamp.
- `duration_ms` is omitted when no matching pre-hook timestamp exists.
- `description` is an optional passthrough of `tool_input.description` when present.
- `action` is shellprint's normalized interpretation of what happened.
- `raw` is the hook payload as received on post/failure.
- No `status`, `detail`, or redaction in v0.

## Runtime Architecture

### 1. Hook Adapter Layer

Responsibility:

- receive SDK hook callbacks
- narrow hook input by `hook_event_name`
- store pre-call timestamps
- convert post/failure payloads into `ShellPrintEvent`

This layer contains no enrichment logic beyond passing data to the enricher and no direct file formatting beyond handing the event to sinks.

### 2. Enricher Layer

Responsibility:

- classify category
- derive action
- build final event object

This should be a pure module: payload in, event fields out.

Inputs:

- `PreToolUseHookInput` timestamp lookup
- `PostToolUseHookInput | PostToolUseFailureHookInput`

Outputs:

- `{ category, description, action, duration_ms, event_id, session_id, ts, tool, raw }`

### 3. Event Pipeline

Responsibility:

- append event to in-memory list
- fan out event to sinks
- isolate sink failures from hook execution

The pipeline should do best-effort delivery:

- sink failure must not break the user's agent run
- callback failure must not break JSONL delivery or the user's agent run
- a failed sink write may be surfaced through an optional `onError` callback later, but v0 can simply swallow after best-effort console warning

### 4. Sink Layer

Responsibility:

- serialize event delivery
- write JSONL
- invoke callbacks

For v0, define a tiny internal sink contract:

```ts
interface EventSink {
  write(event: ShellPrintEvent): Promise<void>;
  flush(): Promise<void>;
}
```

Concrete sinks:

- `JsonlSink`
- `CallbackSink`

The callback sink exists so `onEvent` uses the same pipeline as JSONL instead of being a special case.

## Recommended File Layout

```text
src/
  index.ts
  types.ts
  hooks.ts
  enricher.ts
  sinks.ts
```

### File responsibilities

`index.ts`

- exports public types
- exports `createShellPrint`
- assembles sinks and hook matchers

`types.ts`

- package event types
- minimal hook payload helper types
- option types

`hooks.ts`

- duration tracking map
- hook callbacks
- matcher creation
- event dispatch orchestration

`enricher.ts`

- bash category classifier
- action builders
- event constructor

`sinks.ts`

- JSONL writer with serialized append queue
- callback sink
- sink composition helper

## Key Design Decisions

### Use serialized async writes, not synchronous append

Reason:

- hook callbacks may fire in quick succession
- sync file writes inside hook callbacks add avoidable latency
- queued async writes preserve event order and reduce blocking

Implementation shape:

- maintain `writeChain: Promise<void>`
- each write appends to the chain
- `flush()` awaits the current chain

### Keep duration tracking local and lossy

Reason:

- `duration_ms` is useful but not critical
- missing pre-hook state should degrade gracefully

Implementation:

- `Map<string, number>` keyed by `tool_use_id`
- store `Date.now()` on pre-hook
- read and delete on post/failure

### Failure hooks are first-class, but not over-modeled

Observed fact:

- the SDK types include `PostToolUseFailure`
- the saved fixtures do not yet include a real failure payload

Architecture response:

- support `PostToolUseFailure` structurally now
- keep event shape identical except `raw` holds the failure payload
- do not add `status` until live behavior is verified

### Preserve raw payloads exactly

Reason:

- this is the developer escape hatch
- it avoids argument about what v0 should extract

Constraint:

- do not mutate `raw`
- any enrichment must live at top level beside `raw`
- if the SDK provides `tool_input.description`, preserve it as an optional top-level `description` field instead of forcing callers to dig through `raw`

## Enrichment Rules

### Category

For non-Bash tools, use direct tool mapping:

- `Read` -> `file_read`
- `Grep` -> `content_search`
- `Glob` -> `file_search`
- `Edit` -> `file_edit`
- everything else -> `tool_use`

For Bash, classify by deterministic regex against `tool_input.command`.

Recommended order:

1. `version_control`
2. `database`
3. `infrastructure`
4. `package_mgmt`
5. `web_request`
6. `file_system`
7. `file_read`
8. `computation`
9. `shell`

This order reduces obvious misclassification. Example: `python script.py && curl ...` should usually land in `web_request` only if the network action is the dominant primitive, but command-string classification is inherently approximate. Keeping a final fallback category avoids false precision.

### Action

`description` and `action` are intentionally different fields:

- `description` is Claude's original wording from the SDK payload when available
- `action` is shellprint's normalized display string

For Bash:

- always derive a normalized action from the command
- preserve `tool_input.description` separately when present

For `Read`:

- `Read {file_path}`

For `Grep`:

- `Searched for '{pattern}' in {glob}`

For `Glob`:

- `Searched for {pattern}`

For `Edit`:

- `Edited {file_path}`

Fallback:

- `{tool_name} tool call`

### Bash action fallback

Do not attempt natural-language generation. Use deterministic extraction:

- first executable token
- first one or two meaningful arguments
- map common commands to templates where cheap

Examples:

- `curl -s https://api.github.com/orgs/anthropics` -> `Ran curl against https://api.github.com/orgs/anthropics`
- `git clone ...` -> `Ran git clone`
- unknown -> `Ran bash command: {trimmedCommand}`

## Error Handling

Hook callbacks must always resolve successfully unless the process is already aborting.

Rules:

- sink failure must not throw through the hook callback
- malformed tool payloads should still produce a fallback event when possible
- unknown shapes should never crash classification or action generation

## Testing Strategy

### Unit tests

Test pure enrichment against saved fixtures and synthetic failures.

Coverage:

- Bash with description
- Bash without description
- Grep action
- Read action
- missing pre-hook timestamp
- category classifier edge cases
- `PostToolUseFailure` synthetic payload

### Integration tests

Build an offline test harness that:

- replays fixture payloads through the hook adapter
- asserts event count
- asserts JSONL line count
- asserts durations for known pre/post pairs

### Live verification

Run the existing verifier against the live SDK to collect:

- at least one true `PostToolUseFailure` payload
- at least one additional non-Bash tool type if available

The live test is validation of SDK behavior, not the main correctness mechanism.

## Major Risks and Mitigations

### Risk: default JSONL path is unwritable

Mitigation:

- resolve the default relative file once at `createShellPrint()` time using process cwd
- fail open if writing breaks
- let callers override `jsonlPath`

### Risk: hook callbacks race under concurrent tool use

Mitigation:

- duration map keyed by `tool_use_id`
- serialized sink writes
- append event to memory before sink fan-out

### Risk: Bash classifier is noisy

Mitigation:

- classify only into coarse buckets
- keep fallback `shell`
- do not expose the classifier as a stable semantic contract

### Risk: raw payloads contain secrets

Mitigation:

- accept for local MVP
- document clearly that redaction is deferred and external sinks should wait

## Architecture Review

I reviewed the design against the MVP and the current fixtures. The original 3-file split is workable, but it couples hook logic and I/O too tightly. Splitting out `sinks.ts` removes that coupling without making the package meaningfully larger. The other major issue was process-exit correctness for JSONL output; adding `flush()` resolves that cleanly.

I do not see major unresolved architecture issues for v0 after these changes. The only remaining uncertainty is live `PostToolUseFailure` behavior, which is a contract-validation problem rather than an architecture flaw.
