import { resolve } from "node:path";

import { createHookMatchers } from "./hooks.js";
import {
  CallbackSink,
  JsonlSink,
  MultiSink,
  type EventSink,
} from "./sinks.js";
import type { ShellPrint, ShellPrintEvent, ShellPrintOptions } from "./types.js";

export * from "./types.js";

const DEFAULT_JSONL_FILENAME = "shellprint-events.jsonl";

export function createShellPrint(options: ShellPrintOptions = {}): ShellPrint {
  const jsonlPath = resolve(
    process.cwd(),
    options.jsonlPath ?? DEFAULT_JSONL_FILENAME,
  );

  const sinks: EventSink[] = [new JsonlSink(jsonlPath)];
  if (options.onEvent) {
    sinks.push(new CallbackSink(options.onEvent));
  }

  const sink = new MultiSink(sinks);
  const events: ShellPrintEvent[] = [];
  const matchers = createHookMatchers({ sink, events });

  return {
    ...matchers,
    getEvents() {
      return events.slice();
    },
    flush() {
      return sink.flush();
    },
  };
}
