import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeTool, isReadOperation, TOOL_DEFS } from "./tools.js";

const TEST_DIR = join(tmpdir(), `conf-agent-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("TOOL_DEFS", () => {
  it("has 5 tool definitions", () => {
    expect(TOOL_DEFS).toHaveLength(5);
  });

  it("includes all required tools", () => {
    const names = TOOL_DEFS.map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("run_command");
    expect(names).toContain("list_files");
  });
});

describe("isReadOperation", () => {
  it("returns true for read_file and list_files", () => {
    expect(isReadOperation("read_file")).toBe(true);
    expect(isReadOperation("list_files")).toBe(true);
  });

  it("returns false for write operations", () => {
    expect(isReadOperation("write_file")).toBe(false);
    expect(isReadOperation("edit_file")).toBe(false);
    expect(isReadOperation("run_command")).toBe(false);
  });
});

describe("executeTool", () => {
  describe("read_file", () => {
    it("reads an existing file", async () => {
      const filePath = join(TEST_DIR, "test.txt");
      await writeFile(filePath, "hello world");

      const result = await executeTool("read_file", { path: filePath });
      expect(result.success).toBe(true);
      expect(result.output).toBe("hello world");
    });

    it("returns error for non-existent file", async () => {
      const result = await executeTool("read_file", { path: join(TEST_DIR, "nope.txt") });
      expect(result.success).toBe(false);
    });
  });

  describe("write_file", () => {
    it("creates a new file", async () => {
      const filePath = join(TEST_DIR, "new.txt");
      const result = await executeTool("write_file", { path: filePath, content: "new content" });
      expect(result.success).toBe(true);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("new content");
    });

    it("overwrites an existing file", async () => {
      const filePath = join(TEST_DIR, "existing.txt");
      await writeFile(filePath, "old");

      await executeTool("write_file", { path: filePath, content: "new" });
      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("new");
    });
  });

  describe("edit_file", () => {
    it("replaces matching content", async () => {
      const filePath = join(TEST_DIR, "edit.txt");
      await writeFile(filePath, "hello world");

      const result = await executeTool("edit_file", {
        path: filePath,
        old_content: "world",
        new_content: "universe",
      });
      expect(result.success).toBe(true);

      const content = await readFile(filePath, "utf-8");
      expect(content).toBe("hello universe");
    });

    it("fails when old_content not found", async () => {
      const filePath = join(TEST_DIR, "edit2.txt");
      await writeFile(filePath, "hello");

      const result = await executeTool("edit_file", {
        path: filePath,
        old_content: "missing",
        new_content: "replaced",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("run_command", () => {
    it("runs a simple command", async () => {
      const result = await executeTool("run_command", { command: "echo hello" });
      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("hello");
    });

    it("returns error for failing command", async () => {
      const result = await executeTool("run_command", { command: "false" });
      expect(result.success).toBe(false);
    });
  });

  describe("list_files", () => {
    it("lists files in a directory", async () => {
      await writeFile(join(TEST_DIR, "a.txt"), "");
      await writeFile(join(TEST_DIR, "b.txt"), "");

      const result = await executeTool("list_files", { path: TEST_DIR, recursive: false });
      expect(result.success).toBe(true);
      expect(result.output).toContain("a.txt");
      expect(result.output).toContain("b.txt");
    });

    it("returns error for non-existent directory", async () => {
      const result = await executeTool("list_files", { path: "/nonexistent", recursive: false });
      expect(result.success).toBe(false);
    });
  });
});
