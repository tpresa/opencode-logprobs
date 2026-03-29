import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deepMergeConfig, validateConfig, loadConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./providers/types.js";

// ── Helpers ──

function makeTempDir(): string {
  const dir = join(tmpdir(), `conf-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeTempConfig(dir: string, config: Record<string, unknown>): string {
  const filePath = join(dir, "config.json");
  writeFileSync(filePath, JSON.stringify(config));
  return filePath;
}

// ── deepMergeConfig ──

describe("deepMergeConfig", () => {
  it("returns defaults when loaded config is empty", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {});
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it("deep-merges nested objects, preserving unspecified defaults", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {
      scoring: { flagThreshold: 0.80 },
    });
    expect(result.scoring.flagThreshold).toBe(0.80);
    expect(result.scoring.aggregation).toBe("mean");
    expect(result.scoring.showScores).toBe(true);
  });

  it("replaces arrays instead of concatenating", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {
      models: [{ provider: "openai", model: "o3" }],
    });
    expect(result.models).toEqual([{ provider: "openai", model: "o3" }]);
    expect(result.models).toHaveLength(1);
  });

  it("merges keys, preserving unspecified providers", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {
      keys: { openai: "sk-test" },
    });
    expect(result.keys.openai).toBe("sk-test");
    expect(result.keys.google).toBeNull();
    expect(result.keys.together).toBeNull();
  });

  it("preserves arbitrary provider names in keys", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {
      keys: { anthropic: "sk-ant-..." },
    });
    expect(result.keys["anthropic"]).toBe("sk-ant-...");
    expect(result.keys.openai).toBeNull();
  });

  it("overrides scalar values", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {
      retry: { maxRetries: 5 },
    });
    expect(result.retry.maxRetries).toBe(5);
    expect(result.retry.autoRetry).toBe(false);
  });

  it("skips unknown top-level keys during merge", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {
      unknownKey: "value",
      scoring: { flagThreshold: 0.50 },
    });
    expect(result.scoring.flagThreshold).toBe(0.50);
    expect((result as unknown as Record<string, unknown>)["unknownKey"]).toBeUndefined();
  });

  it("skips unknown nested keys during merge", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {
      scoring: { flagThreshold: 0.70, unknownNested: "bad" },
    });
    expect(result.scoring.flagThreshold).toBe(0.70);
    expect((result.scoring as unknown as Record<string, unknown>)["unknownNested"]).toBeUndefined();
  });

  it("merges multiple sections at once", () => {
    const result = deepMergeConfig(DEFAULT_CONFIG, {
      ensemble: { enabled: true, selectionMargin: 0.05 },
      verification: { testCommand: "npm test" },
    });
    expect(result.ensemble.enabled).toBe(true);
    expect(result.ensemble.selectionMargin).toBe(0.05);
    expect(result.ensemble.maxModels).toBe(3);
    expect(result.verification.testCommand).toBe("npm test");
    expect(result.verification.autoRun).toBe(true);
  });
});

// ── validateConfig ──

describe("validateConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a valid partial config without errors", () => {
    expect(() =>
      validateConfig({
        scoring: { flagThreshold: 0.80 },
        retry: { maxRetries: 5 },
      })
    ).not.toThrow();
  });

  it("accepts an empty config", () => {
    expect(() => validateConfig({})).not.toThrow();
  });

  it("warns on unknown top-level keys", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateConfig({ unknownTopLevel: true });
    expect(spy).toHaveBeenCalledWith("Unknown config key: unknownTopLevel");
  });

  it("warns on unknown nested keys", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateConfig({ scoring: { unknownNested: 42 } });
    expect(spy).toHaveBeenCalledWith("Unknown config key: scoring.unknownNested");
  });

  it("throws on invalid enum value with allowed values listed", () => {
    expect(() =>
      validateConfig({ scoring: { aggregation: "median" } })
    ).toThrow("scoring.aggregation must be one of: mean|min|p10");
  });

  it("throws on wrong type for number field", () => {
    expect(() =>
      validateConfig({ retry: { maxRetries: "five" } })
    ).toThrow("retry.maxRetries must be a number");
  });

  it("throws on wrong type for boolean field", () => {
    expect(() =>
      validateConfig({ ensemble: { enabled: "yes" } })
    ).toThrow("ensemble.enabled must be a boolean");
  });

  it("throws when models is not an array", () => {
    expect(() =>
      validateConfig({ models: "not-an-array" })
    ).toThrow("models must be an array");
  });

  it("throws when model element is not an object", () => {
    expect(() =>
      validateConfig({ models: ["bad"] })
    ).toThrow("models[0] must be an object");
  });

  it("throws when model element has non-string provider", () => {
    expect(() =>
      validateConfig({ models: [{ provider: 123, model: "x" }] })
    ).toThrow("models[0].provider must be a string");
  });

  it("throws when model element is missing model field", () => {
    expect(() =>
      validateConfig({ models: [{ provider: "openai" }] })
    ).toThrow("models[0].model must be a string");
  });

  it("throws when keys value is not string or null", () => {
    expect(() =>
      validateConfig({ keys: { openai: 123 } })
    ).toThrow("keys.openai must be a string or null");
  });

  it("accepts keys with arbitrary provider names", () => {
    expect(() =>
      validateConfig({ keys: { anthropic: "sk-ant-..." } })
    ).not.toThrow();
  });

  it("throws when nested section is not an object", () => {
    expect(() =>
      validateConfig({ ensemble: "bad" })
    ).toThrow("ensemble must be an object");
  });

  it("accepts string|null fields with null value", () => {
    expect(() =>
      validateConfig({ verification: { testCommand: null } })
    ).not.toThrow();
  });

  it("accepts string|null fields with string value", () => {
    expect(() =>
      validateConfig({ verification: { testCommand: "npm test" } })
    ).not.toThrow();
  });

  it("throws when string|null field has wrong type", () => {
    expect(() =>
      validateConfig({ verification: { testCommand: 42 } })
    ).toThrow("verification.testCommand must be a string or null");
  });
});

// ── loadConfig ──

describe("loadConfig", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
    vi.restoreAllMocks();
  });

  it("returns defaults when no config is found during search", async () => {
    // Isolate both cwd and HOME so cosmiconfig's global search
    // (which walks up to homedir) cannot find a real config.
    const dir = makeTempDir();
    tempDirs.push(dir);
    const originalCwd = process.cwd();
    const originalHome = process.env["HOME"];
    try {
      process.chdir(dir);
      process.env["HOME"] = dir;
      const result = await loadConfig();
      expect(result).toEqual(DEFAULT_CONFIG);
    } finally {
      process.chdir(originalCwd);
      process.env["HOME"] = originalHome;
    }
  });

  it("throws 'not found' when explicit path does not exist", async () => {
    await expect(loadConfig("/nonexistent/path/config.json")).rejects.toThrow(
      "Config file not found"
    );
  });

  it("throws a parse error (not 'not found') for malformed config", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "config.json");
    writeFileSync(filePath, "{ invalid json!!! }");

    try {
      await loadConfig(filePath);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("Failed to load config file");
      expect((err as Error).message).not.toContain("Config file not found");
    }
  });

  it("loads and merges config from explicit path", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = writeTempConfig(dir, {
      scoring: { flagThreshold: 0.75 },
      models: [{ provider: "openai", model: "gpt-4o" }],
    });

    const result = await loadConfig(filePath);

    expect(result.scoring.flagThreshold).toBe(0.75);
    expect(result.scoring.aggregation).toBe("mean"); // preserved from defaults
    expect(result.models).toEqual([{ provider: "openai", model: "gpt-4o" }]);
    expect(result.models).toHaveLength(1);
  });

  it("throws on empty config file with explicit path", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = join(dir, "config.json");
    writeFileSync(filePath, "");

    await expect(loadConfig(filePath)).rejects.toThrow(/Config file/);
  });

  it("validates config and throws on invalid values", async () => {
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = writeTempConfig(dir, {
      scoring: { aggregation: "invalid" },
    });

    await expect(loadConfig(filePath)).rejects.toThrow(
      "scoring.aggregation must be one of: mean|min|p10"
    );
  });

  it("warns on unknown keys when loading from file", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = makeTempDir();
    tempDirs.push(dir);
    const filePath = writeTempConfig(dir, {
      unknownField: true,
      scoring: { flagThreshold: 0.50 },
    });

    const result = await loadConfig(filePath);

    expect(spy).toHaveBeenCalledWith("Unknown config key: unknownField");
    expect(result.scoring.flagThreshold).toBe(0.50);
  });
});
