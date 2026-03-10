/**
 * Step 1: Verify what the Agent SDK hook API actually gives us.
 * Registers PreToolUse + PostToolUse on all tools, dumps raw payloads to JSON.
 * Run once, then build everything else against the saved data.
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import {
  query,
  type HookCallback,
  type HookCallbackMatcher,
} from "@anthropic-ai/claude-agent-sdk";

const payloads: any[] = [];

const preToolHook: HookCallback = async (input, toolUseId, _options) => {
  const payload = {
    hook: "PreToolUse",
    ts: Date.now(),
    tool_use_id: toolUseId,
    input,
  };
  payloads.push(payload);
  console.log("\n--- PreToolUse ---");
  console.log(JSON.stringify(payload, null, 2));
  return {};
};

const postToolHook: HookCallback = async (input, toolUseId, _options) => {
  const payload = {
    hook: "PostToolUse",
    ts: Date.now(),
    tool_use_id: toolUseId,
    input,
  };
  payloads.push(payload);
  console.log("\n--- PostToolUse ---");
  console.log(JSON.stringify(payload, null, 2));
  return {};
};

const matcher: HookCallbackMatcher = { hooks: [preToolHook] };
const postMatcher: HookCallbackMatcher = { hooks: [postToolHook] };

const prompt = [
  "Do these tasks using bash commands:",
  "1. curl https://api.github.com/orgs/anthropics to get their org info",
  "2. Use grep to search for 'const ' in this file (verify_hooks.ts)",
  "3. Read the file .gitignore in the current directory",
  "4. Run 'echo hello world'",
  "5. Run a command that will fail: 'ls /nonexistent_dir'",
].join("\n");

console.log("=".repeat(60));
console.log("HOOK VERIFICATION — capturing raw payloads (TypeScript)");
console.log("=".repeat(60));

const q = query({
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
      PreToolUse: [matcher],
      PostToolUse: [postMatcher],
    },
  },
});

for await (const message of q) {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "text" && block.text) {
        console.log(`\n[ASSISTANT] ${block.text.slice(0, 150)}`);
      }
    }
  } else if (message.type === "result") {
    console.log(
      `\n\nDONE: ${message.subtype} | Cost: $${message.total_cost_usd?.toFixed(4)} | Turns: ${message.num_turns}`
    );
  }
}

// Save payloads
writeFileSync("hook_payloads.json", JSON.stringify(payloads, null, 2));
console.log(`\n${"=".repeat(60)}`);
console.log(`Saved ${payloads.length} hook payloads to hook_payloads.json`);
console.log("=".repeat(60));
