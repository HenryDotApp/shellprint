import "dotenv/config";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { query } from "@anthropic-ai/claude-agent-sdk";

import { createShellPrint } from "./src/index.js";

async function main() {
  await rm("./shellprint-live-events.jsonl", { force: true });

  const shellprint = createShellPrint({
    jsonlPath: "./shellprint-live-events.jsonl",
  });

  const prompt = [
    "Do these tasks using bash commands:",
    "1. curl https://api.github.com/orgs/anthropics to get their org info",
    "2. Use grep to search for 'const ' in this file (verify_shellprint.ts)",
    "3. Read the file .gitignore in the current directory",
    "4. Run 'echo hello world'",
  ].join("\n");

  const result = query({
    prompt,
    options: {
      allowedTools: ["Bash", "Read", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      maxTurns: 10,
      systemPrompt:
        "You are a research assistant with full access to bash tools. " +
        "Use curl, grep, and other CLI tools freely. " +
        "You may generate and use any URLs needed.",
      hooks: {
        PreToolUse: [shellprint.preToolMatcher],
        PostToolUse: [shellprint.postToolMatcher],
        PostToolUseFailure: [shellprint.failureMatcher],
      },
    },
  });

  for await (const _message of result) {
    // The package should not interfere with the caller's existing loop.
  }

  await shellprint.flush();

  const events = shellprint.getEvents();
  assert.ok(events.length >= 4, "expected at least four emitted events");

  const curlEvent = events.find(
    (event) =>
      event.tool === "Bash" &&
      getToolInputString(event.raw.tool_input, "command") ===
        "curl -s https://api.github.com/orgs/anthropics",
  );
  assert.ok(curlEvent, "expected curl event");
  assert.equal(curlEvent.category, "web_request");
  assert.ok(curlEvent.description, "expected curl description");
  assert.equal(
    curlEvent.action,
    "Ran curl against https://api.github.com/orgs/anthropics",
  );

  const grepEvent = events.find((event) => event.tool === "Grep");
  assert.ok(grepEvent, "expected grep event");
  assert.equal(grepEvent.category, "content_search");
  assert.match(grepEvent.action, /verify_shellprint\.ts/);

  const readEvent = events.find((event) => event.tool === "Read");
  assert.ok(readEvent, "expected read event");
  assert.equal(readEvent.category, "file_read");

  const echoEvent = events.find(
    (event) =>
      event.tool === "Bash" &&
      getToolInputString(event.raw.tool_input, "command") === "echo hello world",
  );
  if (echoEvent) {
    assert.equal(echoEvent.description, "Echo hello world");
    assert.equal(echoEvent.action, "Ran echo hello");
  }

  console.log(`Captured ${events.length} shellprint events`);
  for (const event of events) {
    const descriptionPart = event.description
      ? ` | description=${event.description}`
      : "";
    console.log(
      `[EVENT] ${event.tool} | ${event.category} | action=${event.action}${descriptionPart}`,
    );
  }
}

function getToolInputString(
  toolInput: unknown,
  field: string,
): string | undefined {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return undefined;
  }

  const candidate = (toolInput as Record<string, unknown>)[field];
  return typeof candidate === "string" ? candidate : undefined;
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
