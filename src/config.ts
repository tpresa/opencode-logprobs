import { cosmiconfig } from "cosmiconfig";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Config } from "./providers/types.js";
import { DEFAULT_CONFIG } from "./providers/types.js";

// ── Public API ──

export async function loadConfig(explicitPath?: string): Promise<Config> {
  if (explicitPath) {
    return loadExplicit(explicitPath);
  }
  return loadSearch();
}

// ── Load from explicit --config path ──

async function loadExplicit(filePath: string): Promise<Config> {
  const explorer = cosmiconfig("conf-agent");
  const resolved = resolve(filePath);

  let result;
  try {
    result = await explorer.load(resolved);
  } catch (err: unknown) {
    if (isEnoent(err)) {
      throw new Error(`Config file not found: ${resolved}`, { cause: err });
    }
    throw new Error(`Failed to load config file: ${resolved}: ${err instanceof Error ? err.message : err}`, { cause: err });
  }

  if (!result || result.isEmpty) {
    throw new Error(`Config file is empty: ${resolved}`);
  }

  const raw = result.config as Record<string, unknown>;
  assertObject(raw);
  validateConfig(raw);
  return deepMergeConfig(DEFAULT_CONFIG, raw);
}

// ── Search via cosmiconfig ──

async function loadSearch(): Promise<Config> {
  const explorer = cosmiconfig("conf-agent", {
    searchStrategy: "global",
    stopDir: homedir(),
  });

  const result = await explorer.search();
  if (!result || result.isEmpty) {
    return DEFAULT_CONFIG;
  }

  const raw = result.config as Record<string, unknown>;
  assertObject(raw);
  validateConfig(raw);
  return deepMergeConfig(DEFAULT_CONFIG, raw);
}

// ── Deep merge ──

const PASSTHROUGH_KEYS = new Set(["keys"]);

export function deepMergeConfig(
  defaults: Config,
  loaded: Record<string, unknown>,
): Config {
  return deepMerge(defaults as unknown as Record<string, unknown>, loaded) as unknown as Config;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  parentKey?: string,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    // For passthrough keys (e.g. "keys"), preserve arbitrary entries from source.
    if (PASSTHROUGH_KEYS.has(key) && isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = { ...targetVal, ...(sourceVal as Record<string, unknown>) };
      continue;
    }

    if (!(key in result) && parentKey === undefined) {
      // Unknown top-level key — already warned by validateConfig, skip during merge.
      continue;
    }

    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
        key,
      );
    } else {
      // Arrays and scalars: replace.
      result[key] = sourceVal;
    }
  }

  return result;
}

// ── Validation ──

type Rule =
  | { type: "boolean" }
  | { type: "number" }
  | { type: "string|null" }
  | { type: "enum"; values: string[] }
  | { type: "object"; rules: Record<string, Rule> }
  | { type: "keys" }
  | { type: "models" };

const CONFIG_RULES: Record<string, Rule> = {
  models: { type: "models" },
  keys: { type: "keys" },
  ensemble: {
    type: "object",
    rules: {
      enabled: { type: "boolean" },
      selectionMargin: { type: "number" },
      maxModels: { type: "number" },
    },
  },
  scoring: {
    type: "object",
    rules: {
      aggregation: { type: "enum", values: ["mean", "min", "p10"] },
      flagThreshold: { type: "number" },
      showScores: { type: "boolean" },
    },
  },
  verification: {
    type: "object",
    rules: {
      autoRun: { type: "boolean" },
      testCommand: { type: "string|null" },
      lintCommand: { type: "string|null" },
    },
  },
  retry: {
    type: "object",
    rules: {
      maxRetries: { type: "number" },
      autoRetry: { type: "boolean" },
    },
  },
};

export function validateConfig(raw: Record<string, unknown>): void {
  validateNode(raw, CONFIG_RULES, "");
}

function validateNode(
  obj: Record<string, unknown>,
  rules: Record<string, Rule>,
  prefix: string,
): void {
  for (const key of Object.keys(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const rule = rules[key];

    if (!rule) {
      console.warn(`Unknown config key: ${path}`);
      continue;
    }

    const value = obj[key];
    validateValue(value, rule, path);
  }
}

function validateValue(value: unknown, rule: Rule, path: string): void {
  switch (rule.type) {
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(`${path} must be a boolean`);
      }
      break;

    case "number":
      if (typeof value !== "number") {
        throw new Error(`${path} must be a number`);
      }
      break;

    case "string|null":
      if (value !== null && typeof value !== "string") {
        throw new Error(`${path} must be a string or null`);
      }
      break;

    case "enum":
      if (typeof value !== "string" || !rule.values.includes(value)) {
        throw new Error(`${path} must be one of: ${rule.values.join("|")}`);
      }
      break;

    case "object":
      if (!isPlainObject(value)) {
        throw new Error(`${path} must be an object`);
      }
      validateNode(value as Record<string, unknown>, rule.rules, path);
      break;

    case "keys":
      if (!isPlainObject(value)) {
        throw new Error(`${path} must be an object`);
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== null && typeof v !== "string") {
          throw new Error(`${path}.${k} must be a string or null`);
        }
      }
      break;

    case "models":
      if (!Array.isArray(value)) {
        throw new Error(`${path} must be an array`);
      }
      for (let i = 0; i < value.length; i++) {
        const el = value[i];
        if (!isPlainObject(el)) {
          throw new Error(`${path}[${i}] must be an object`);
        }
        const obj = el as Record<string, unknown>;
        if (typeof obj.provider !== "string") {
          throw new Error(`${path}[${i}].provider must be a string`);
        }
        if (typeof obj.model !== "string") {
          throw new Error(`${path}[${i}].model must be a string`);
        }
      }
      break;
  }
}

// ── Helpers ──

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function assertObject(v: unknown): asserts v is Record<string, unknown> {
  if (!isPlainObject(v)) {
    throw new Error("Config must be an object");
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}
