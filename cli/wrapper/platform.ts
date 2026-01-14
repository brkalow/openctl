/**
 * Platform detection for PTY wrapper compatibility.
 *
 * The PTY wrapper relies on POSIX features that are not available on Windows.
 * This module provides early detection and helpful error messages.
 */

/**
 * Check if the current platform supports the PTY wrapper
 * @throws Error if platform is not supported
 */
export function checkPlatform(): void {
  if (process.platform === "win32") {
    console.error("Error: Interactive sessions are not yet supported on Windows.");
    console.error("This feature requires POSIX terminal support (macOS, Linux).");
    console.error("");
    console.error("You can still use:");
    console.error("  - archive daemon   (passive observation)");
    console.error("  - archive upload   (manual session upload)");
    process.exit(1);
  }
}

/**
 * Check if we're running in a TTY environment
 */
export function isTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Get platform info for debugging
 */
export function getPlatformInfo(): {
  platform: string;
  arch: string;
  isTTY: boolean;
  terminalColumns: number;
  terminalRows: number;
} {
  return {
    platform: process.platform,
    arch: process.arch,
    isTTY: isTTY(),
    terminalColumns: process.stdout.columns || 80,
    terminalRows: process.stdout.rows || 24,
  };
}
