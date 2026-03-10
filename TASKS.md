# shellprint MVP Tasks

## Status Legend

- `pending`
- `in_progress`
- `blocked`
- `completed`

## Task List

### 1. Set up the package structure

- Status: `pending`
- Create the minimal source layout under `src/`.
- Update `package.json` and `tsconfig.json` so the package builds from `src` into `dist`.
- Keep the module layout small and aligned with the architecture doc.

Completion criteria:
- source files exist
- build config points at the new layout
- no extra folders or abstractions were introduced without need

### 2. Define the public types and factory contract

- Status: `pending`
- Define the MVP event type, category type, options, and factory return shape.
- Keep SDK-specific types internal wherever possible.
- Lock the public API to `createShellPrint()`, hook matchers, `getEvents()`, and `flush()`.

Completion criteria:
- event shape matches the MVP and architecture docs
- public API is small and stable enough to implement against
- internal types support both post-success and post-failure hook payloads

### 3. Implement event enrichment

- Status: `pending`
- Implement deterministic category classification and action generation.
- Prefer Bash `description` when present and use simple command parsing as fallback.
- Support at least Bash, Read, Grep, Glob, Edit, and unknown tools.

Completion criteria:
- enrichment is pure and testable
- malformed or partial payloads degrade to safe fallback values
- no LLM calls or speculative detail extraction are introduced

### 4. Implement hook handling and event emission

- Status: `pending`
- Implement `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` handling.
- Track duration by `tool_use_id`.
- Build enriched events and store them in memory.

Completion criteria:
- pre/post correlation works when both hooks are present
- missing pre-hook state does not break emission
- hook handlers do not throw during normal failure cases

### 5. Implement output delivery

- Status: `pending`
- Connect completed events to output delivery.
- Write events to JSONL in a safe serialized order.
- Support the optional `onEvent` callback without letting callback failures break hook execution.
- Add `flush()` so callers can await pending writes before process exit.
- Preserve the zero-config path by making JSONL output work with sensible defaults and no required options.

Completion criteria:
- JSONL output is one event per line
- writes preserve event order
- `flush()` waits for pending writes
- default construction writes locally without extra configuration

### 6. Add offline tests using saved fixtures

- Status: `pending`
- Replay `hook_payloads.json` through the implementation.
- Assert representative categories, summaries, event count, and duration behavior.
- Verify JSONL output shape and line count.
- Verify the default zero-config path works in tests without passing custom options.

Completion criteria:
- fixture replay passes end to end
- core enrichment cases are covered
- file output is verified without requiring the live SDK
- the default constructor path is exercised at least once

### 7. Add synthetic failure coverage

- Status: `pending`
- Add tests for `PostToolUseFailure` using synthetic payloads.
- Verify that failure payloads still produce valid events and preserve `raw`.
- Do not add `status` inference or extra failure modeling in v0.

Completion criteria:
- failure-path behavior is covered even without a saved live fixture
- duration handling still works when a pre-hook exists
- tests stay within current MVP scope

### 8. Run a live verification pass

- Status: `pending`
- Run the TypeScript verifier with local credentials after offline tests pass.
- Confirm the implementation still matches real SDK hook behavior.
- Try to capture a real `PostToolUseFailure` payload if the SDK produces one.

Completion criteria:
- live run completes or the blocker is documented clearly
- any contract mismatch is recorded and fixed if it affects the MVP
- this step validates the implementation but does not expand scope

### 9. Validate sample output

- Status: `pending`
- Generate a representative JSONL sample from the implementation and review it against the broker-UI use case described in `MVP.md`.
- Confirm the emitted events are actually readable and useful, not just structurally correct.
- Keep this as a product-sanity check, not a new feature phase.

Completion criteria:
- there is a concrete sample output from the implemented package
- the sample preserves raw payloads and has useful action/category fields
- no new scope is added during the review

### 10. Review scope and finalize

- Status: `pending`
- Review the final package against `MVP.md` and `ARCHITECTURE.md`.
- Remove anything that feels like framework-building rather than MVP delivery.
- Re-run tests after final fixes and confirm the package builds cleanly.

Completion criteria:
- implementation remains lightweight
- tests pass after the final cleanup pass
- no major issues remain in architecture, scope, or verification
