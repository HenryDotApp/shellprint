import type { HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";

export type ShellPrintCategory =
  | "content_search"
  | "database"
  | "file_edit"
  | "file_read"
  | "file_search"
  | "file_system"
  | "infrastructure"
  | "package_mgmt"
  | "shell"
  | "tool_use"
  | "version_control"
  | "web_request"
  | "computation";

export type ShellPrintHookEventName = "PostToolUse" | "PostToolUseFailure";

export type ShellPrintRawPayload = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
  agent_id?: string;
  agent_type?: string;
  hook_event_name: ShellPrintHookEventName;
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  tool_response?: unknown;
  error?: string;
  is_interrupt?: boolean;
  [key: string]: unknown;
};

export type ShellPrintEvent = {
  event_id: string;
  session_id: string;
  ts: string;
  duration_ms?: number;
  category: ShellPrintCategory;
  description?: string;
  action: string;
  tool: string;
  raw: ShellPrintRawPayload;
};

export type ShellPrintEventHandler = (
  event: ShellPrintEvent,
) => void | Promise<void>;

export type ShellPrintOptions = {
  jsonlPath?: string;
  onEvent?: ShellPrintEventHandler;
};

export type ShellPrint = {
  preToolMatcher: HookCallbackMatcher;
  postToolMatcher: HookCallbackMatcher;
  failureMatcher: HookCallbackMatcher;
  getEvents(): ShellPrintEvent[];
  flush(): Promise<void>;
};
