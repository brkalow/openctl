import { watch, statSync } from "fs";
import { debug } from "./debug";

export class Tail extends EventTarget {
  private filePath: string;
  private position: number = 0;
  private watcher: ReturnType<typeof watch> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private buffer: string = "";
  private pollIntervalMs: number;
  private isReading: boolean = false;

  constructor(filePath: string, options: { startFromEnd?: boolean; pollIntervalMs?: number } = {}) {
    super();
    this.filePath = filePath;
    this.pollIntervalMs = options.pollIntervalMs ?? 2000; // Default 2 second polling fallback

    if (options.startFromEnd) {
      // Synchronously get size - use Bun.spawnSync or check if file exists
      try {
        const stat = require("fs").statSync(filePath);
        this.position = stat.size;
      } catch {
        this.position = 0;
      }
    }
  }

  start(): void {
    debug(`Tail starting from position ${this.position}`);
    this.readNewContent();

    // Watch for file changes (primary mechanism)
    this.watcher = watch(this.filePath, (eventType) => {
      if (eventType === "change") {
        this.readNewContent();
      }
    });

    // Polling fallback - fs.watch() can miss events on macOS
    this.pollInterval = setInterval(() => {
      this.readNewContent();
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async readNewContent(): Promise<void> {
    // Prevent concurrent reads which could cause position issues
    if (this.isReading) return;
    this.isReading = true;

    try {
      // Loop to catch any content added during async read
      while (true) {
        // Use statSync for accurate current file size
        let size: number;
        try {
          size = statSync(this.filePath).size;
        } catch {
          break; // File may have been deleted
        }

        if (size < this.position) {
          // File was truncated
          this.position = 0;
          this.buffer = "";
        }

        if (size <= this.position) {
          break; // No new content
        }

        // Read new content using Bun's file API with slice
        const file = Bun.file(this.filePath);
        const slice = file.slice(this.position, size);
        const content = await slice.text();
        const bytesRead = size - this.position;
        this.position = size;

        this.buffer += content;

        // Emit complete lines
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";

        debug(`Read ${bytesRead} bytes, ${lines.length} complete lines`);

        for (const line of lines) {
          if (line.trim()) {
            this.dispatchEvent(new CustomEvent("line", { detail: line }));
          }
        }
      }
    } catch (err) {
      this.dispatchEvent(new CustomEvent("error", { detail: err }));
    } finally {
      this.isReading = false;
    }
  }

  getPosition(): number {
    return this.position;
  }
}
