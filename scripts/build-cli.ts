#!/usr/bin/env bun

/**
 * Build script for cross-platform CLI binaries
 *
 * Builds standalone executables for:
 * - macOS (arm64, x64)
 * - Linux (arm64, x64)
 * - Windows (x64)
 */

import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const TARGETS = [
  { target: "bun-darwin-arm64", name: "openctl-darwin-arm64" },
  { target: "bun-darwin-x64", name: "openctl-darwin-x64" },
  { target: "bun-linux-x64", name: "openctl-linux-x64" },
  { target: "bun-linux-arm64", name: "openctl-linux-arm64" },
  { target: "bun-windows-x64", name: "openctl-windows-x64.exe" },
] as const;

const DIST_DIR = join(import.meta.dir, "..", "dist");
const CLI_ENTRY = join(import.meta.dir, "..", "cli", "index.ts");

async function getVersion(): Promise<string> {
  const pkg = await Bun.file(
    join(import.meta.dir, "..", "package.json")
  ).json();
  return pkg.version || "0.0.0";
}

async function build() {
  const version = await getVersion();
  console.log(`Building openctl v${version} for all platforms...\n`);

  // Clean and create dist directory
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  const results: { target: string; success: boolean; error?: string }[] = [];

  for (const { target, name } of TARGETS) {
    const outfile = join(DIST_DIR, name);
    console.log(`Building ${target}...`);

    try {
      const result = await Bun.build({
        entrypoints: [CLI_ENTRY],
        compile: {
          target,
          outfile,
        },
        minify: true,
        define: {
          "process.env.OPENCTL_VERSION": JSON.stringify(version),
        },
      });

      if (result.success) {
        console.log(`  -> ${name}`);
        results.push({ target, success: true });
      } else {
        console.error(`  Build logs:`);
        for (const log of result.logs) {
          console.error(`    [${log.level}] ${log.message}`);
        }
        const errors = result.logs
          .filter((log) => log.level === "error")
          .map((log) => log.message)
          .join(", ");
        results.push({ target, success: false, error: errors || "Unknown error" });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`  Failed: ${error}`);
      results.push({ target, success: false, error });
    }
  }

  console.log("\n--- Build Summary ---");
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    console.log(`\nSuccessful (${successful.length}):`);
    for (const r of successful) {
      console.log(`  - ${r.target}`);
    }
  }

  if (failed.length > 0) {
    console.log(`\nFailed (${failed.length}):`);
    for (const r of failed) {
      console.log(`  - ${r.target}: ${r.error}`);
    }
    process.exit(1);
  }

  console.log(`\nAll binaries written to: ${DIST_DIR}`);
}

// Get the binary name for the current platform
function getCurrentPlatformBinary(): string | null {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin" && arch === "arm64") return "openctl-darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "openctl-darwin-x64";
  if (platform === "linux" && arch === "x64") return "openctl-linux-x64";
  if (platform === "linux" && arch === "arm64") return "openctl-linux-arm64";
  if (platform === "win32" && arch === "x64") return "openctl-windows-x64.exe";

  return null;
}

// Smoke test the binary for the current platform
async function smokeTest() {
  const version = await getVersion();
  const binaryName = getCurrentPlatformBinary();

  if (!binaryName) {
    console.log(`\nSkipping smoke test: unsupported platform ${process.platform}-${process.arch}`);
    return;
  }

  const binaryPath = join(DIST_DIR, binaryName);
  console.log(`\n--- Smoke Test (${binaryName}) ---\n`);

  // Test 1: --version
  console.log("Testing --version...");
  const versionResult = await $`${binaryPath} --version`.quiet();
  const versionOutput = versionResult.text().trim();
  if (!versionOutput.includes(version)) {
    console.error(`  FAIL: Expected version "${version}" in output, got: "${versionOutput}"`);
    process.exit(1);
  }
  console.log(`  PASS: ${versionOutput}`);

  // Test 2: --help
  console.log("Testing --help...");
  const helpResult = await $`${binaryPath} --help`.quiet();
  const helpOutput = helpResult.text();
  if (!helpOutput.includes("Usage:") || !helpOutput.includes("Commands:")) {
    console.error(`  FAIL: Help output missing expected content`);
    process.exit(1);
  }
  console.log(`  PASS: Help output looks correct`);

  // Test 3: config --help
  console.log("Testing config --help...");
  const configHelpResult = await $`${binaryPath} config --help`.quiet();
  if (!configHelpResult.text().includes("config")) {
    console.error(`  FAIL: Config help output missing expected content`);
    process.exit(1);
  }
  console.log(`  PASS: Config subcommand works`);

  // Test 4: unknown command exits with error
  console.log("Testing unknown command...");
  const unknownResult = await $`${binaryPath} notarealcommand`.quiet().nothrow();
  if (unknownResult.exitCode === 0) {
    console.error(`  FAIL: Unknown command should exit with non-zero code`);
    process.exit(1);
  }
  console.log(`  PASS: Unknown command exits with code ${unknownResult.exitCode}`);

  console.log("\nAll smoke tests passed!");
}

// Create compressed archives for release
async function archive() {
  console.log(`\nCreating release archives...`);

  for (const { name } of TARGETS) {
    const binPath = join(DIST_DIR, name);
    const isWindows = name.endsWith(".exe");
    const baseName = name.replace(".exe", "");
    const archiveName = `${baseName}.tar.gz`;

    // Use tar for all platforms (works for windows too)
    if (isWindows) {
      // For Windows, create a zip instead
      const zipName = `${baseName}.zip`;
      await $`cd ${DIST_DIR} && zip ${zipName} ${name}`.quiet();
      console.log(`  -> ${zipName}`);
    } else {
      await $`cd ${DIST_DIR} && tar -czf ${archiveName} ${name}`.quiet();
      console.log(`  -> ${archiveName}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const shouldArchive = args.includes("--archive") || args.includes("-a");
  const shouldTest = args.includes("--test") || args.includes("-t");

  await build();

  if (shouldTest) {
    await smokeTest();
  }

  if (shouldArchive) {
    await archive();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
