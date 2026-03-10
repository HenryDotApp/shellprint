#!/usr/bin/env python3
"""
Raw test: Run an Agent SDK agent with Bash tools and see what we get
without any observability layer. This is the "before" picture.
"""

import asyncio
import os
from dotenv import load_dotenv
from claude_code_sdk import query, ClaudeCodeOptions, AssistantMessage, ResultMessage

load_dotenv()

# Allow running from within a Claude Code session
os.environ.pop("CLAUDECODE", None)


async def main():
    options = ClaudeCodeOptions(
        allowed_tools=["Bash", "Read", "Glob", "Grep"],
        permission_mode="bypassPermissions",
        max_turns=10,
        system_prompt=(
            "You are a research assistant. You have full access to bash tools. "
            "Use curl, grep, and other CLI tools freely to accomplish tasks. "
            "You may generate and use any URLs needed for research."
        ),
    )

    prompt = (
        "Use bash commands to do the following research tasks:\n"
        "1. Use curl to fetch https://api.github.com/orgs/anthropics and extract their public info\n"
        "2. Use curl to fetch https://api.github.com/orgs/anthropics/repos?per_page=5 and list their top repos\n"
        "3. Check if python3 is installed and what version\n"
        "4. Create a short summary file /tmp/research_output.txt with your findings\n"
        "5. Cat the file to show the results"
    )

    print("=" * 60)
    print("AGENT SESSION — NO OBSERVABILITY")
    print("=" * 60)
    print()

    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if hasattr(block, "text") and block.text:
                    print(f"[ASSISTANT] {block.text[:200]}")
                elif hasattr(block, "name"):
                    # Tool use block
                    tool_input = getattr(block, "input", {})
                    if block.name == "Bash":
                        cmd = tool_input.get("command", "???")
                        desc = tool_input.get("description", "")
                        print(f"\n[TOOL] Bash: {cmd}")
                        if desc:
                            print(f"  desc: {desc}")
                    else:
                        print(f"\n[TOOL] {block.name}: {tool_input}")
                elif hasattr(block, "tool_use_id"):
                    # Tool result block
                    content = getattr(block, "content", "")
                    if isinstance(content, str):
                        preview = content[:150].replace("\n", " ")
                        print(f"  result: {preview}...")
                    elif isinstance(content, list):
                        for item in content:
                            if hasattr(item, "text"):
                                preview = item.text[:150].replace("\n", " ")
                                print(f"  result: {preview}...")

        elif isinstance(message, ResultMessage):
            print()
            print("=" * 60)
            print(f"DONE: {message.subtype}")
            print(f"Cost: ${message.total_cost_usd:.4f}")
            print(f"Turns: {message.num_turns}")
            print(f"Duration: {message.duration_ms}ms")
            print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
