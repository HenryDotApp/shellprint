import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { ShellPrintEvent, ShellPrintEventHandler } from "./types.js";

export interface EventSink {
  write(event: ShellPrintEvent): Promise<void>;
  flush(): Promise<void>;
}

export class JsonlSink implements EventSink {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  write(event: ShellPrintEvent): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;

    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, line, "utf8");
      })
      .catch((error: unknown) => {
        console.warn("[shellprint] failed to write JSONL event", error);
      });

    return this.writeChain;
  }

  flush(): Promise<void> {
    return this.writeChain;
  }
}

export class CallbackSink implements EventSink {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly onEvent: ShellPrintEventHandler) {}

  write(event: ShellPrintEvent): Promise<void> {
    this.writeChain = this.writeChain
      .then(async () => {
        await this.onEvent(event);
      })
      .catch((error: unknown) => {
        console.warn("[shellprint] onEvent callback failed", error);
      });

    return this.writeChain;
  }

  flush(): Promise<void> {
    return this.writeChain;
  }
}

export class MultiSink implements EventSink {
  constructor(private readonly sinks: EventSink[]) {}

  write(event: ShellPrintEvent): Promise<void> {
    return Promise.all(this.sinks.map((sink) => sink.write(event))).then(
      () => undefined,
    );
  }

  flush(): Promise<void> {
    return Promise.all(this.sinks.map((sink) => sink.flush())).then(
      () => undefined,
    );
  }
}
