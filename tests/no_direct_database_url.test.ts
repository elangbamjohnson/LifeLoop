/**
 * tests/no_direct_database_url.test.ts
 *
 * Enforces the architectural rule: no file outside src/db/config.ts may read
 * process.env.DATABASE_URL directly. This prevents any code path from bypassing
 * the dev-DB guard introduced in src/db/config.ts.
 *
 * The scan is purely textual — it does not execute the files.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

// Files that are PERMITTED to reference process.env.DATABASE_URL or DATABASE_URL
// in a meaningful way (i.e. the resolver itself, and files that delete it as a
// safety measure to prevent accidental access in test contexts).
const ALLOW_LIST = new Set([
  // The single allowed source of truth.
  "src/db/config.ts",
  // Test/setup files that delete DATABASE_URL to prevent accidental access.
  // These references are of the form `delete process.env.DATABASE_URL`.
  "src/db/index.ts",            // deletes it in test mode before guard runs
  "src/db/migrateTestSchema.ts",// deletes it in test mode
  "tests/globalSetup.ts",       // deletes it
  "tests/vitest-worker-setup.ts",// deletes it
  "e2e/globalSetup.ts",         // deletes it
  "playwright.config.ts",       // deletes it
  // Test files that use the string "DATABASE_URL" as a literal in test fixture data.
  "tests/db_guard.test.ts",
  "tests/db_config.test.ts",
  // Existing test database safety guard module from feature/live-sync
  "src/db/testDatabaseGuard.ts",
  // Error/log strings that contain the literal word "DATABASE_URL" for user guidance.
  "e2e/fixtures.ts",
  // This test file itself
  "tests/no_direct_database_url.test.ts",
]);

const ROOT = path.resolve(__dirname, "..");

/** Walk a directory, returning all .ts files (excluding node_modules, dist, .git). */
function walkTs(dir: string): string[] {
  const SKIP = new Set(["node_modules", "dist", ".git", "migrations"]);
  const results: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTs(full));
    } else if (stat.isFile() && name.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results;
}

describe("No direct DATABASE_URL read outside src/db/config.ts", () => {
  it("scans all .ts files and finds no disallowed direct DATABASE_URL access", () => {
    const files = walkTs(ROOT);
    const violations: string[] = [];

    for (const absPath of files) {
      const rel = path.relative(ROOT, absPath).replace(/\\/g, "/");
      if (ALLOW_LIST.has(rel)) continue;

      const content = readFileSync(absPath, "utf8");

      // Detect lines that READ process.env.DATABASE_URL (not just mention the string).
      // We flag: process.env.DATABASE_URL (access), env.DATABASE_URL (access),
      //          env["DATABASE_URL"] (access).
      // We do NOT flag: comments or string literals that contain the word as documentation.
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comment lines.
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;
        // Skip lines that are clearly only deleting the var (safety measure).
        if (/delete\s+process\.env\.DATABASE_URL/.test(line)) continue;
        // Flag any remaining reads.
        if (
          /process\.env\.DATABASE_URL/.test(line) ||
          /env\[['"]DATABASE_URL['"]\]/.test(line) ||
          /\benv\.DATABASE_URL\b/.test(line)
        ) {
          violations.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    }

    if (violations.length > 0) {
      const msg =
        "Files outside the allowlist directly read process.env.DATABASE_URL.\n" +
        "Use getConnectionString() from src/db/config.ts instead:\n\n" +
        violations.join("\n");
      expect.fail(msg);
    }
  });
});
