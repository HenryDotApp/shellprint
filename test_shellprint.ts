import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  PostToolUseFailureHookInput,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

import { buildShellPrintEvent } from "./src/enricher.js";
import { createShellPrint } from "./src/index.js";

type CapturedHookPayload = {
  hook: "PreToolUse" | "PostToolUse" | "PostToolUseFailure";
  ts: number;
  tool_use_id: string;
  input: Record<string, unknown>;
};

async function main() {
  await testFixtureReplay();
  await testSyntheticFailureHandling();
  testBashSearchNormalization();
  console.log("shellprint tests passed");
}

async function testFixtureReplay() {
  const tempDir = await mkdtemp(join(tmpdir(), "shellprint-fixture-"));
  const originalCwd = process.cwd();
  const deliveredEvents: Array<{ event_id: string }> = [];

  try {
    process.chdir(tempDir);

    const shellprint = createShellPrint({
      onEvent(event) {
        deliveredEvents.push({ event_id: event.event_id });
      },
    });

    const fixture = await loadFixture();
    const completionPayloads = fixture.filter((payload) => payload.hook !== "PreToolUse");
    const signal = new AbortController().signal;

    for (const payload of fixture) {
      const matcher = pickMatcher(shellprint, payload.hook);
      await matcher.hooks[0](payload.input as never, payload.tool_use_id, {
        signal,
      });
    }

    await shellprint.flush();

    const events = shellprint.getEvents();
    assert.equal(events.length, completionPayloads.length);
    assert.equal(deliveredEvents.length, completionPayloads.length);

    const jsonl = await readFile(join(tempDir, "shellprint-events.jsonl"), "utf8");
    const lines = jsonl.trim().split("\n");
    assert.equal(lines.length, completionPayloads.length);

    const parsed = lines.map((line) => JSON.parse(line));

    const curlFixture = findFixturePayload(
      completionPayloads,
      (payload) => getToolName(payload) === "Bash" && getCommand(payload) === "curl -s https://api.github.com/orgs/anthropics",
    );
    const curlEvent = findEvent(
      parsed,
      (event) => event.raw.tool_name === "Bash" && getRawCommand(event) === "curl -s https://api.github.com/orgs/anthropics",
    );
    assert.equal(curlEvent.action, "Ran curl against https://api.github.com/orgs/anthropics");
    assert.equal(curlEvent.description, getDescription(curlFixture));
    assert.equal(curlEvent.category, "web_request");
    assert.equal(typeof curlEvent.duration_ms, "number");
    assert.equal(curlEvent.raw.hook_event_name, "PostToolUse");

    const grepFixture = findFixturePayload(
      completionPayloads,
      (payload) => getToolName(payload) === "Grep",
    );
    const grepPath = getFixtureToolInputField(grepFixture, "glob") ?? getFixtureToolInputField(grepFixture, "path");
    const grepEvent = findEvent(parsed, (event) => event.raw.tool_name === "Grep");
    assert.equal(
      grepEvent.action,
      grepPath
        ? `Searched for '${getFixtureToolInputField(grepFixture, "pattern")}' in ${grepPath}`
        : `Searched for '${getFixtureToolInputField(grepFixture, "pattern")}'`,
    );
    assert.equal(grepEvent.category, "content_search");

    const readFixture = findFixturePayload(
      completionPayloads,
      (payload) => getToolName(payload) === "Read",
    );
    const readEvent = findEvent(parsed, (event) => event.raw.tool_name === "Read");
    assert.equal(
      readEvent.action,
      `Read ${getFixtureToolInputField(readFixture, "file_path")}`,
    );
    assert.equal(readEvent.category, "file_read");

    const echoFixture = findFixturePayload(
      completionPayloads,
      (payload) => getToolName(payload) === "Bash" && getCommand(payload) === "echo hello world",
    );
    const echoEvent = findEvent(
      parsed,
      (event) => event.raw.tool_name === "Bash" && getRawCommand(event) === "echo hello world",
    );
    assert.equal(echoEvent.action, "Ran echo hello");
    assert.equal(echoEvent.description, getDescription(echoFixture));

    const failingFixture = findFixturePayload(
      completionPayloads,
      (payload) =>
        getToolName(payload) === "Bash" &&
        getCommand(payload)?.startsWith("ls /nonexistent_dir") === true,
    );
    const failingEvent = findEvent(
      parsed,
      (event) =>
        event.raw.tool_name === "Bash" &&
        getRawCommand(event)?.startsWith("ls /nonexistent_dir") === true,
    );
    assert.equal(failingEvent.action, "Ran ls /nonexistent_dir;");
    assert.equal(failingEvent.description, getDescription(failingFixture));
    assert.equal(failingEvent.category, "shell");

    assert.equal(grepEvent.description, getDescription(grepFixture));
    assert.equal(readEvent.description, getDescription(readFixture));
  } finally {
    process.chdir(originalCwd);
  }
}

async function testSyntheticFailureHandling() {
  const tempDir = await mkdtemp(join(tmpdir(), "shellprint-failure-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(tempDir);

    const shellprint = createShellPrint({
      jsonlPath: "nested/failures.jsonl",
    });

    const signal = new AbortController().signal;
    const preInput: PreToolUseHookInput = {
      session_id: "session-1",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: tempDir,
      permission_mode: "bypassPermissions",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {
        command: "curl -s https://example.com",
        description: "",
      },
      tool_use_id: "toolu_failure_with_pre",
    };

    const failureInputWithPre: PostToolUseFailureHookInput = {
      session_id: "session-1",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: tempDir,
      permission_mode: "bypassPermissions",
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: {
        command: "curl -s https://example.com",
        description: "",
      },
      tool_use_id: "toolu_failure_with_pre",
      error: "permission denied",
    };

    const failureInputWithoutPre: PostToolUseFailureHookInput = {
      ...failureInputWithPre,
      tool_use_id: "toolu_failure_no_pre",
      error: "network blocked",
    };

    await shellprint.preToolMatcher.hooks[0](preInput, preInput.tool_use_id, {
      signal,
    });
    await shellprint.failureMatcher.hooks[0](
      failureInputWithPre,
      failureInputWithPre.tool_use_id,
      { signal },
    );
    await shellprint.failureMatcher.hooks[0](
      failureInputWithoutPre,
      failureInputWithoutPre.tool_use_id,
      { signal },
    );

    await shellprint.flush();

    const events = shellprint.getEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].category, "web_request");
    assert.equal(events[0].action, "Ran curl against https://example.com");
    assert.equal(events[0].description, undefined);
    assert.equal(events[0].raw.hook_event_name, "PostToolUseFailure");
    assert.equal(typeof events[0].duration_ms, "number");
    assert.equal(events[1].duration_ms, undefined);

    const jsonl = await readFile(join(tempDir, "nested/failures.jsonl"), "utf8");
    const lines = jsonl.trim().split("\n");
    assert.equal(lines.length, 2);
  } finally {
    process.chdir(originalCwd);
  }
}

function testBashSearchNormalization() {
  const event = buildShellPrintEvent({
    session_id: "session-search",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp",
    permission_mode: "bypassPermissions",
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: {
      command: "grep 'const ' verify_shellprint.ts",
      description: "Search for 'const ' in verify_shellprint.ts",
    },
    tool_response: {
      stdout: "",
      stderr: "",
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
    },
    tool_use_id: "toolu_search",
  });

  assert.equal(event.category, "content_search");
  assert.equal(event.action, "Searched for 'const ' in verify_shellprint.ts");
  assert.equal(
    event.description,
    "Search for 'const ' in verify_shellprint.ts",
  );
}

async function loadFixture(): Promise<CapturedHookPayload[]> {
  const contents = await readFile(
    new URL("../hook_payloads.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(contents) as CapturedHookPayload[];
}

function pickMatcher(
  shellprint: ReturnType<typeof createShellPrint>,
  hook: CapturedHookPayload["hook"],
) {
  switch (hook) {
    case "PreToolUse":
      return shellprint.preToolMatcher;
    case "PostToolUse":
      return shellprint.postToolMatcher;
    case "PostToolUseFailure":
      return shellprint.failureMatcher;
  }
}

function findFixturePayload(
  fixture: CapturedHookPayload[],
  predicate: (payload: CapturedHookPayload) => boolean,
): CapturedHookPayload {
  const payload = fixture.find(predicate);
  assert.ok(payload, "expected fixture payload was not found");
  return payload;
}

function findEvent(
  events: Array<Record<string, any>>,
  predicate: (event: Record<string, any>) => boolean,
): Record<string, any> {
  const event = events.find(predicate);
  assert.ok(event, "expected event was not found");
  return event;
}

function getToolName(payload: CapturedHookPayload): string | undefined {
  return typeof payload.input.tool_name === "string" ? payload.input.tool_name : undefined;
}

function getCommand(payload: CapturedHookPayload): string | undefined {
  return getFixtureToolInputField(payload, "command");
}

function getDescription(payload: CapturedHookPayload): string | undefined {
  return getFixtureToolInputField(payload, "description");
}

function getFixtureToolInputField(
  payload: CapturedHookPayload,
  field: string,
): string | undefined {
  const toolInput = payload.input.tool_input;
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return undefined;
  }

  const candidate = (toolInput as Record<string, unknown>)[field];
  return typeof candidate === "string" ? candidate : undefined;
}

function getRawCommand(event: Record<string, any>): string | undefined {
  const toolInput = event.raw?.tool_input;
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return undefined;
  }

  const command = (toolInput as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
