import type {
  HookCallback,
  HookCallbackMatcher,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

import { buildShellPrintEvent } from "./enricher.js";
import { freezeEvent, type EventSink } from "./sinks.js";
import type { ShellPrintEvent } from "./types.js";

type HookMatchers = {
  preToolMatcher: HookCallbackMatcher;
  postToolMatcher: HookCallbackMatcher;
  failureMatcher: HookCallbackMatcher;
};

export function createHookMatchers(params: {
  sink: EventSink;
  events: ShellPrintEvent[];
}): HookMatchers {
  const { sink, events } = params;
  const startedAtByToolUseId = new Map<string, number>();

  const preToolHook: HookCallback = async (input) => {
    if (input.hook_event_name === "PreToolUse") {
      startedAtByToolUseId.set(input.tool_use_id, Date.now());
    }

    return {};
  };

  const postToolHook: HookCallback = async (input) => {
    if (input.hook_event_name === "PostToolUse") {
      emitEvent(input);
    }

    return {};
  };

  const failureHook: HookCallback = async (input) => {
    if (input.hook_event_name === "PostToolUseFailure") {
      emitEvent(input);
    }

    return {};
  };

  function emitEvent(input: PostToolUseHookInput | PostToolUseFailureHookInput) {
    const startedAt = startedAtByToolUseId.get(input.tool_use_id);
    startedAtByToolUseId.delete(input.tool_use_id);

    const event = freezeEvent(buildShellPrintEvent(input, startedAt));
    events.push(event);
    void sink.write(event);
  }

  return {
    preToolMatcher: { hooks: [preToolHook] },
    postToolMatcher: { hooks: [postToolHook] },
    failureMatcher: { hooks: [failureHook] },
  };
}
