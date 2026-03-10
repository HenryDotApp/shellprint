import type {
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  ShellPrintCategory,
  ShellPrintEvent,
  ShellPrintRawPayload,
} from "./types.js";

type CompletionHookInput = PostToolUseHookInput | PostToolUseFailureHookInput;
type ToolInputRecord = Record<string, unknown>;

const BASH_PATTERNS: Array<[RegExp, ShellPrintCategory]> = [
  [/git\s+(push|pull|commit|clone)\b/i, "version_control"],
  [/\b(psql|mysql|sqlite|mongo)\b/i, "database"],
  [/\b(docker|kubectl|terraform)\b/i, "infrastructure"],
  [/\b(npm|pip|cargo|brew)\b/i, "package_mgmt"],
  [/\b(curl|wget|http|fetch)\b/i, "web_request"],
  [/\b(grep|rg)\b/i, "content_search"],
  [/\b(mkdir|cp|mv|rm|touch)\b/i, "file_system"],
  [/\b(awk|sed|cat|head|tail)\b/i, "file_read"],
  [/\b(python|python3|node|ruby)\b/i, "computation"],
];

const TOOL_CATEGORY_MAP: Record<string, ShellPrintCategory> = {
  Edit: "file_edit",
  Glob: "file_search",
  Grep: "content_search",
  Read: "file_read",
};

export function buildShellPrintEvent(
  input: CompletionHookInput,
  startedAt?: number,
  completedAt: number = Date.now(),
): ShellPrintEvent {
  const durationMs =
    typeof startedAt === "number"
      ? Math.max(0, completedAt - startedAt)
      : undefined;

  const event: ShellPrintEvent = {
    event_id: input.tool_use_id,
    session_id: input.session_id,
    ts: new Date(completedAt).toISOString(),
    category: classifyCategory(input),
    action: buildAction(input),
    tool: input.tool_name,
    raw: input as unknown as ShellPrintRawPayload,
  };

  const description = getDescription(input.tool_input);
  if (description) {
    event.description = description;
  }

  if (durationMs !== undefined) {
    event.duration_ms = durationMs;
  }

  return event;
}

export function classifyCategory(input: CompletionHookInput): ShellPrintCategory {
  if (input.tool_name !== "Bash") {
    return TOOL_CATEGORY_MAP[input.tool_name] ?? "tool_use";
  }

  const command = getStringField(input.tool_input, "command");
  if (!command) {
    return "shell";
  }

  for (const [pattern, category] of BASH_PATTERNS) {
    if (pattern.test(command)) {
      return category;
    }
  }

  return "shell";
}

export function buildAction(input: CompletionHookInput): string {
  switch (input.tool_name) {
    case "Bash":
      return summarizeBashAction(input.tool_input);
    case "Read":
      return buildFileSummary("Read", input.tool_input);
    case "Edit":
      return buildFileSummary("Edited", input.tool_input);
    case "Grep":
      return summarizeGrep(input.tool_input);
    case "Glob":
      return summarizeGlob(input.tool_input);
    default:
      return `${input.tool_name} tool call`;
  }
}

function summarizeBashAction(toolInput: unknown): string {
  const command = getStringField(toolInput, "command")?.trim();
  if (!command) {
    return "Ran bash command";
  }

  return summarizeCommand(command);
}

function summarizeCommand(command: string): string {
  const tokens = tokenizeCommand(command);
  const executable = tokens[0];

  if (!executable) {
    return `Ran bash command: ${truncate(command, 80)}`;
  }

  if (executable === "curl" || executable === "wget") {
    const target = findFirstMeaningfulArgument(tokens.slice(1));
    return target
      ? `Ran ${executable} against ${truncate(target, 80)}`
      : `Ran ${executable}`;
  }

  if (executable === "git") {
    const subcommand = findFirstMeaningfulArgument(tokens.slice(1));
    return subcommand ? `Ran git ${subcommand}` : "Ran git";
  }

  if (executable === "grep" || executable === "rg") {
    return summarizeSearchCommand(executable, tokens.slice(1));
  }

  const firstArg = findFirstMeaningfulArgument(tokens.slice(1));
  return firstArg
    ? `Ran ${executable} ${truncate(firstArg, 60)}`
    : `Ran ${executable}`;
}

function summarizeSearchCommand(
  executable: string,
  tokens: string[],
): string {
  const pattern = findFirstMeaningfulArgument(tokens) ?? "pattern";
  const patternIndex = tokens.findIndex((token) => token === pattern);
  const scope =
    patternIndex >= 0
      ? findFirstMeaningfulArgument(tokens.slice(patternIndex + 1))
      : undefined;

  return scope
    ? `Searched for '${truncate(pattern, 40)}' in ${truncate(scope, 80)}`
    : `Searched for '${truncate(pattern, 40)}' with ${executable}`;
}

function summarizeGrep(toolInput: unknown): string {
  const pattern = getStringField(toolInput, "pattern") ?? "pattern";
  const scope =
    getStringField(toolInput, "glob") ?? getStringField(toolInput, "path");
  return scope
    ? `Searched for '${pattern}' in ${scope}`
    : `Searched for '${pattern}'`;
}

function summarizeGlob(toolInput: unknown): string {
  const pattern =
    getStringField(toolInput, "pattern") ??
    getStringField(toolInput, "glob") ??
    getStringField(toolInput, "path") ??
    "files";
  return `Searched for ${pattern}`;
}

function buildFileSummary(action: "Read" | "Edited", toolInput: unknown): string {
  const filePath =
    getStringField(toolInput, "file_path") ??
    getStringField(toolInput, "path") ??
    getStringField(toolInput, "target_file");
  return filePath ? `${action} ${filePath}` : `${action} file`;
}

function tokenizeCommand(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map(stripQuotes);
}

function stripQuotes(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }

  return token;
}

function findFirstMeaningfulArgument(tokens: string[]): string | undefined {
  return tokens.find((token) => token.length > 0 && !token.startsWith("-"));
}

function getStringField(
  value: unknown,
  field: string,
): string | undefined {
  const record = asRecord(value);
  const candidate = record?.[field];
  return typeof candidate === "string" ? candidate : undefined;
}

function asRecord(value: unknown): ToolInputRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as ToolInputRecord;
}

function getDescription(toolInput: unknown): string | undefined {
  const description = getStringField(toolInput, "description")?.trim();
  return description ? description : undefined;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
