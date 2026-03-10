import "dotenv/config";

import { query } from "@anthropic-ai/claude-agent-sdk";

import { createShellPrint } from "./src/index.js";

async function main() {
  const shellprint = createShellPrint({
    jsonlPath: "./shellprint-example-events.jsonl",
    onEvent(event) {
      const descriptionPart = event.description
        ? ` | description=${event.description}`
        : "";
      console.log(
        `[shellprint] ${event.tool} | ${event.category} | action=${event.action}${descriptionPart}`,
      );
    },
  });

  const result = query({
    prompt: [
      "Do these tasks using bash commands:",
      "1. curl https://api.github.com/orgs/anthropics to get their org info",
      "2. Use grep to search for 'createShellPrint' in example_query.ts",
      "3. Read the file .gitignore in the current directory",
      "4. Run 'echo hello world'",
    ].join("\n"),
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

  for await (const message of result) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text" && block.text) {
          console.log(`[assistant] ${block.text.slice(0, 160)}`);
        }
      }
    }

    if (message.type === "result") {
      console.log(
        `[result] ${message.subtype} | turns=${message.num_turns} | cost=$${message.total_cost_usd?.toFixed(4)}`,
      );
    }
  }

  await shellprint.flush();

  const events = shellprint.getEvents();
  console.log(`Captured ${events.length} events`);
  console.log("JSONL written to ./shellprint-example-events.jsonl");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
