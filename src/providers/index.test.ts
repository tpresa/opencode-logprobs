import { describe, it, expect, vi, afterEach } from "vitest";
import {
  resolveApiKey,
  resolveModelName,
  createProvider,
  initProviders,
  OpenAIProvider,
  GoogleProvider,
  TogetherProvider,
} from "./index.js";
import { DEFAULT_CONFIG } from "./types.js";
import type { Config } from "./types.js";

// ── Helpers ──

function makeConfig(overrides: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, ...overrides };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── resolveApiKey ──

describe("resolveApiKey", () => {
  it("returns env var when both env var and config key are set", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    const result = resolveApiKey("openai", { openai: "sk-config" });
    expect(result).toBe("sk-env");
  });

  it("returns env var when config key is null", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    const result = resolveApiKey("openai", { openai: null });
    expect(result).toBe("sk-env");
  });

  it("returns config key when env var is not set", () => {
    delete process.env.OPENAI_API_KEY;
    const result = resolveApiKey("openai", { openai: "sk-config" });
    expect(result).toBe("sk-config");
  });

  it("returns config key when env var is empty string", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = resolveApiKey("openai", { openai: "sk-config" });
    expect(result).toBe("sk-config");
  });

  it("returns config key when env var is whitespace-only", () => {
    vi.stubEnv("OPENAI_API_KEY", "   ");
    const result = resolveApiKey("openai", { openai: "sk-config" });
    expect(result).toBe("sk-config");
  });

  it("returns null when both are missing", () => {
    delete process.env.OPENAI_API_KEY;
    const result = resolveApiKey("openai", { openai: null });
    expect(result).toBeNull();
  });

  it("trims whitespace from env var value", () => {
    vi.stubEnv("OPENAI_API_KEY", "  sk-env  ");
    const result = resolveApiKey("openai", { openai: null });
    expect(result).toBe("sk-env");
  });

  it("trims whitespace from config key value", () => {
    delete process.env.OPENAI_API_KEY;
    const result = resolveApiKey("openai", { openai: "  sk-config  " });
    expect(result).toBe("sk-config");
  });

  it("returns null for unknown provider with no config entry", () => {
    const result = resolveApiKey("unknown", {});
    expect(result).toBeNull();
  });
});

// ── resolveModelName ──

describe("resolveModelName", () => {
  it("resolves known alias", () => {
    expect(resolveModelName("deepseek-v3")).toBe("deepseek-ai/DeepSeek-V3");
  });

  it("passes through non-aliased names unchanged", () => {
    expect(resolveModelName("gpt-4.1")).toBe("gpt-4.1");
    expect(resolveModelName("gemini-2.5-pro")).toBe("gemini-2.5-pro");
  });
});

// ── createProvider ──

describe("createProvider", () => {
  it("creates an OpenAIProvider", () => {
    const p = createProvider("openai", "gpt-4.1", "sk-test");
    expect(p).toBeInstanceOf(OpenAIProvider);
    expect(p.id).toBe("openai");
  });

  it("creates a TogetherProvider with alias-resolved model", () => {
    const p = createProvider("together", "deepseek-v3", "tok-test");
    expect(p).toBeInstanceOf(TogetherProvider);
    expect(p.id).toBe("together");
  });

  it("throws on unknown provider name", () => {
    expect(() => createProvider("anthropic", "claude-4", "key")).toThrow(
      /Unknown provider "anthropic"/,
    );
    expect(() => createProvider("anthropic", "claude-4", "key")).toThrow(
      /Available providers: openai, google, together/,
    );
  });
});

// ── initProviders with --model override ──

describe("initProviders with --model", () => {
  it("returns single provider when model found and key available", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const providers = initProviders(makeConfig(), { model: "gpt-4.1" });
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("openai");
  });

  it("throws when model not found in config", () => {
    expect(() => initProviders(makeConfig(), { model: "gpt-5" })).toThrow(
      /Model "gpt-5" not found in config/,
    );
  });

  it("throws when model found but no API key available", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() =>
      initProviders(makeConfig({ keys: { openai: null, google: null, together: null } }), {
        model: "gpt-4.1",
      }),
    ).toThrow(/No API key for provider "openai"/);
  });

  it("error message includes env var name", () => {
    delete process.env.GOOGLE_API_KEY;
    expect(() =>
      initProviders(makeConfig({ keys: { openai: null, google: null, together: null } }), {
        model: "gemini-2.5-pro",
      }),
    ).toThrow(/GOOGLE_API_KEY/);
  });
});

// ── initProviders from config ──

describe("initProviders from config", () => {
  it("returns all providers when all keys available", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-1");
    vi.stubEnv("GOOGLE_API_KEY", "gk-1");
    vi.stubEnv("TOGETHER_API_KEY", "tk-1");
    const providers = initProviders(makeConfig(), {});
    expect(providers).toHaveLength(3);
    expect(providers.map((p) => p.id)).toEqual(["openai", "google", "together"]);
  });

  it("skips providers without valid keys", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-1");
    delete process.env.GOOGLE_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    const providers = initProviders(
      makeConfig({ keys: { openai: null, google: null, together: null } }),
      {},
    );
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe("openai");
  });

  it("preserves config order", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-1");
    vi.stubEnv("TOGETHER_API_KEY", "tk-1");
    delete process.env.GOOGLE_API_KEY;
    const config = makeConfig({
      models: [
        { provider: "together", model: "deepseek-v3" },
        { provider: "openai", model: "gpt-4.1" },
        { provider: "google", model: "gemini-2.5-pro" },
      ],
      keys: { openai: null, google: null, together: null },
    });
    const providers = initProviders(config, {});
    expect(providers.map((p) => p.id)).toEqual(["together", "openai"]);
  });

  it("caps at maxModels", () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-1");
    vi.stubEnv("GOOGLE_API_KEY", "gk-1");
    vi.stubEnv("TOGETHER_API_KEY", "tk-1");
    const config = makeConfig({
      ensemble: { ...DEFAULT_CONFIG.ensemble, maxModels: 2 },
    });
    const providers = initProviders(config, {});
    expect(providers).toHaveLength(2);
    expect(providers.map((p) => p.id)).toEqual(["openai", "google"]);
  });

  it("throws when zero providers have valid keys", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    expect(() =>
      initProviders(makeConfig({ keys: { openai: null, google: null, together: null } }), {}),
    ).toThrow(/No providers available/);
  });

  it("throws on unknown provider in config models", () => {
    const config = makeConfig({
      models: [{ provider: "anthropic", model: "claude-4" }],
    });
    expect(() => initProviders(config, {})).toThrow(
      /Unknown provider "anthropic" in config models/,
    );
  });

  it("treats empty-string config key as missing", () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    const config = makeConfig({
      models: [{ provider: "openai", model: "gpt-4.1" }],
      keys: { openai: "" },
    });
    expect(() => initProviders(config, {})).toThrow(/No providers available/);
  });
});
