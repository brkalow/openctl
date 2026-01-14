/**
 * Session Watcher - Watches directories for new session files.
 *
 * Monitors watch paths defined by harness adapters and starts/stops
 * session tracking when files are created or deleted.
 */

import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "fs";
import { join } from "path";
import type { HarnessAdapter } from "../adapters/types";
import { SessionTracker, type StartSessionResult } from "./session-tracker";

export class SessionWatcher {
  private watchers: FSWatcher[] = [];
  private knownFiles = new Set<string>();

  constructor(
    private adapters: HarnessAdapter[],
    private tracker: SessionTracker
  ) {}

  start(): void {
    for (const adapter of this.adapters) {
      const paths = adapter.getWatchPaths();

      for (const watchPath of paths) {
        this.watchDirectory(watchPath, adapter);
      }
    }
  }

  private watchDirectory(dirPath: string, adapter: HarnessAdapter): void {
    // Ensure directory exists
    if (!existsSync(dirPath)) {
      console.log(`Watch path does not exist (yet): ${dirPath}`);
      return;
    }

    console.log(`Watching: ${dirPath}`);

    // Scan for existing files (in case daemon starts mid-session)
    this.scanExistingFiles(dirPath, adapter);

    // Watch for new files and changes
    const watcher = watch(
      dirPath,
      { recursive: true },
      (eventType, filename) => {
        if (!filename) return;

        const fullPath = join(dirPath, filename);

        if (!adapter.canHandle(fullPath)) return;

        if (eventType === "rename") {
          // File created or deleted
          if (existsSync(fullPath) && !this.knownFiles.has(fullPath)) {
            this.tryStartSession(fullPath, adapter);
          } else if (!existsSync(fullPath) && this.knownFiles.has(fullPath)) {
            this.knownFiles.delete(fullPath);
            this.tracker.endSession(fullPath);
          }
        } else if (eventType === "change") {
          // File content changed - try to start tracking if not already
          // This handles the case where a session was initially skipped
          // (e.g., empty or no valid messages) but now has content
          if (existsSync(fullPath) && !this.knownFiles.has(fullPath)) {
            this.tryStartSession(fullPath, adapter);
          }
        }
      }
    );

    this.watchers.push(watcher);
  }

  /**
   * Try to start a session and only mark as known if we should stop retrying.
   * Files that return 'retry_later' will be retried on subsequent changes.
   */
  private async tryStartSession(filePath: string, adapter: HarnessAdapter): Promise<void> {
    const result = await this.tracker.startSession(filePath, adapter);
    // Only add to knownFiles if we shouldn't retry
    // 'retry_later' means file is empty/invalid but may have content later
    if (result !== 'retry_later') {
      this.knownFiles.add(filePath);
    }
  }

  private scanExistingFiles(dirPath: string, adapter: HarnessAdapter): void {
    try {
      this.scanDirectory(dirPath, adapter);
    } catch (err) {
      console.error(`Error scanning ${dirPath}:`, err);
    }
  }

  private scanDirectory(dirPath: string, adapter: HarnessAdapter): void {
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        this.scanDirectory(fullPath, adapter);
      } else if (entry.isFile() && adapter.canHandle(fullPath)) {
        // Check if file was recently modified (active session)
        const stats = statSync(fullPath);
        const ageMs = Date.now() - stats.mtimeMs;

        // Consider files modified in the last 5 minutes as potentially active
        if (ageMs < 5 * 60 * 1000) {
          // Auto-start tracking for recent sessions
          console.log(`  Found recent session, attempting: ${fullPath}`);
          // Fire-and-forget: tryStartSession handles adding to knownFiles based on result
          this.tryStartSession(fullPath, adapter);
        }
      }
    }
  }

  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }
}
