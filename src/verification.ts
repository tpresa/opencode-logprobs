import { execSync } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

// ── Verification results ──

export interface VerificationResult {
  passed: boolean;
  testOutput?: string;
  lintOutput?: string;
}

// ── Run verification (tests + lint) after applying tool calls ──

export async function verify(
  cwd: string,
  testCommand?: string | null,
  lintCommand?: string | null
): Promise<VerificationResult> {
  const test = testCommand ?? (await detectTestCommand(cwd));
  const lint = lintCommand ?? (await detectLintCommand(cwd));

  let testOutput: string | undefined;
  let lintOutput: string | undefined;
  let passed = true;

  if (test) {
    try {
      testOutput = execSync(test, { cwd, encoding: "utf-8", timeout: 60_000 });
    } catch (err: unknown) {
      testOutput = err instanceof Error ? err.message : String(err);
      passed = false;
    }
  }

  if (lint) {
    try {
      lintOutput = execSync(lint, { cwd, encoding: "utf-8", timeout: 30_000 });
    } catch (err: unknown) {
      lintOutput = err instanceof Error ? err.message : String(err);
      passed = false;
    }
  }

  return { passed, testOutput, lintOutput };
}

// ── Auto-detect project tooling ──

async function detectTestCommand(cwd: string): Promise<string | null> {
  if (await fileExists(join(cwd, "package.json"))) return "npm test";
  if (await fileExists(join(cwd, "Cargo.toml"))) return "cargo test";
  if (await fileExists(join(cwd, "go.mod"))) return "go test ./...";
  if (await fileExists(join(cwd, "pyproject.toml"))) return "pytest";
  if (await fileExists(join(cwd, "Makefile"))) return "make test";
  return null;
}

async function detectLintCommand(cwd: string): Promise<string | null> {
  if (await fileExists(join(cwd, "package.json"))) return "npm run lint --if-present";
  if (await fileExists(join(cwd, "Cargo.toml"))) return "cargo clippy";
  if (await fileExists(join(cwd, "go.mod"))) return "golangci-lint run";
  if (await fileExists(join(cwd, "pyproject.toml"))) return "ruff check .";
  return null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
