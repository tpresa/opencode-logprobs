import { readFile, writeFile, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { ToolDef } from "./providers/types.js";

// ── Tool definitions sent to models ──

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "read_file",
    description: "Read the contents of a file",
    parameters: {
      path: { type: "string", description: "Path to the file to read" },
    },
  },
  {
    name: "write_file",
    description: "Write content to a file (creates or overwrites)",
    parameters: {
      path: { type: "string", description: "Path to the file to write" },
      content: { type: "string", description: "Content to write" },
    },
  },
  {
    name: "edit_file",
    description: "Apply a search-and-replace edit to a file",
    parameters: {
      path: { type: "string", description: "Path to the file to edit" },
      old_content: { type: "string", description: "Text to search for" },
      new_content: { type: "string", description: "Text to replace with" },
    },
  },
  {
    name: "run_command",
    description: "Run a shell command and return its output",
    parameters: {
      command: { type: "string", description: "Shell command to execute" },
    },
  },
  {
    name: "list_files",
    description: "List files in a directory",
    parameters: {
      path: { type: "string", description: "Directory path" },
      recursive: { type: "boolean", description: "List recursively" },
    },
  },
];

// ── Tool execution ──

export type ToolName = "read_file" | "write_file" | "edit_file" | "run_command" | "list_files";

export interface ToolExecResult {
  success: boolean;
  output: string;
}

export async function executeTool(
  name: ToolName,
  args: Record<string, unknown>
): Promise<ToolExecResult> {
  switch (name) {
    case "read_file":
      return execReadFile(args.path as string);
    case "write_file":
      return execWriteFile(args.path as string, args.content as string);
    case "edit_file":
      return execEditFile(
        args.path as string,
        args.old_content as string,
        args.new_content as string
      );
    case "run_command":
      return execRunCommand(args.command as string);
    case "list_files":
      return execListFiles(args.path as string, args.recursive as boolean);
    default:
      return { success: false, output: `Unknown tool: ${name}` };
  }
}

export function isReadOperation(name: string): boolean {
  return name === "read_file" || name === "list_files";
}

// ── Individual tool implementations ──

async function execReadFile(path: string): Promise<ToolExecResult> {
  try {
    const content = await readFile(path, "utf-8");
    return { success: true, output: content };
  } catch (err) {
    return { success: false, output: `Error reading ${path}: ${err}` };
  }
}

async function execWriteFile(path: string, content: string): Promise<ToolExecResult> {
  try {
    await writeFile(path, content, "utf-8");
    return { success: true, output: `Wrote ${content.length} bytes to ${path}` };
  } catch (err) {
    return { success: false, output: `Error writing ${path}: ${err}` };
  }
}

async function execEditFile(
  path: string,
  oldContent: string,
  newContent: string
): Promise<ToolExecResult> {
  try {
    const file = await readFile(path, "utf-8");
    if (!file.includes(oldContent)) {
      return { success: false, output: `old_content not found in ${path}` };
    }
    const updated = file.replace(oldContent, newContent);
    await writeFile(path, updated, "utf-8");
    return { success: true, output: `Edited ${path}` };
  } catch (err) {
    return { success: false, output: `Error editing ${path}: ${err}` };
  }
}

function execRunCommand(command: string): Promise<ToolExecResult> {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return Promise.resolve({ success: true, output });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Promise.resolve({ success: false, output: `Command failed: ${message}` });
  }
}

async function execListFiles(path: string, recursive: boolean): Promise<ToolExecResult> {
  try {
    const entries = await readdir(path, { recursive, withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => (e.parentPath ? join(e.parentPath, e.name) : e.name));
    return { success: true, output: files.join("\n") };
  } catch (err) {
    return { success: false, output: `Error listing ${path}: ${err}` };
  }
}
