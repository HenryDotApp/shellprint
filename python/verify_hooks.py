#!/usr/bin/env python3
"""
Step 1: Verify what the Agent SDK hook API actually gives us.
Registers PreToolUse + PostToolUse on all tools, dumps raw payloads to JSON.

IMPORTANT: Must use ClaudeSDKClient (not query()) because hooks only work
in streaming mode, and query() with a string prompt uses non-streaming mode.
"""

import asyncio
import json
import os
import time
from dotenv import load_dotenv
from claude_code_sdk import (
    ClaudeSDKClient,
    ClaudeCodeOptions,
    HookMatcher,
    AssistantMessage,
    ResultMessage,
)

load_dotenv()

PAYLOADS_FILE = "hook_payloads.json"
payloads = []


async def pre_tool(tool_input, tool_use_id, context):
    payload = {
        "hook": "PreToolUse",
        "ts": time.time(),
        "tool_use_id": tool_use_id,
        "tool_input": tool_input,
    }
    payloads.append(payload)
    print(f"\n--- PreToolUse ---")
    print(json.dumps(payload, indent=2, default=str))
    return {}


async def post_tool(tool_input, tool_use_id, context):
    payload = {
        "hook": "PostToolUse",
        "ts": time.time(),
        "tool_use_id": tool_use_id,
        "tool_input": tool_input,
    }
    payloads.append(payload)
    print(f"\n--- PostToolUse ---")
    print(json.dumps(payload, indent=2, default=str))
    return {}


async def main():
    options = ClaudeCodeOptions(
        allowed_tools=["Bash", "Read", "Glob", "Grep"],
        permission_mode="bypassPermissions",
        max_turns=10,
        system_prompt=(
            "You are a research assistant with full access to bash tools. "
            "Use curl, grep, and other CLI tools freely. "
            "You may generate and use any URLs needed."
        ),
        hooks={
            "PreToolUse": [HookMatcher(matcher=None, hooks=[pre_tool])],
            "PostToolUse": [HookMatcher(matcher=None, hooks=[post_tool])],
        },
    )

    prompt = (
        "Do these tasks using bash commands:\n"
        "1. curl https://api.github.com/orgs/anthropics to get their org info\n"
        "2. Use grep to search for 'def ' in this file (verify_hooks.py)\n"
        "3. Read the file .gitignore in the current directory\n"
        "4. Run 'echo hello world'\n"
        "5. Run a command that will fail: 'ls /nonexistent_dir'"
    )

    print("=" * 60)
    print("HOOK VERIFICATION — capturing raw payloads")
    print("=" * 60)

    async with ClaudeSDKClient(options) as client:
        await client.query(prompt)

        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if hasattr(block, "text") and block.text:
                        print(f"\n[ASSISTANT] {block.text[:150]}")
            elif isinstance(message, ResultMessage):
                print(f"\n\nDONE: {message.subtype} | Cost: ${message.total_cost_usd:.4f} | Turns: {message.num_turns}")

    # Save payloads
    with open(PAYLOADS_FILE, "w") as f:
        json.dump(payloads, f, indent=2, default=str)

    print(f"\n{'=' * 60}")
    print(f"Saved {len(payloads)} hook payloads to {PAYLOADS_FILE}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    asyncio.run(main())
