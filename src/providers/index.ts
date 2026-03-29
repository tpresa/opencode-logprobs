export { OpenAIProvider } from "./openai.js";
export { GoogleProvider } from "./google.js";
export { TogetherProvider } from "./together.js";
export type {
  Provider,
  GenerationResult,
  ToolCallResult,
  TokenLogprob,
  Message,
  ToolDef,
  Config,
  ModelConfig,
} from "./types.js";
export { DEFAULT_CONFIG } from "./types.js";

import { OpenAIProvider } from "./openai.js";
import { GoogleProvider } from "./google.js";
import { TogetherProvider } from "./together.js";
import type { Provider, Config } from "./types.js";

// ── Provider registry ──

type ProviderConstructor = new (apiKey: string, model?: string) => Provider;

const PROVIDER_REGISTRY: Record<string, ProviderConstructor> = {
  openai: OpenAIProvider,
  google: GoogleProvider,
  together: TogetherProvider,
};

// ── Env var mapping ──

const ENV_VAR_MAP: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  together: "TOGETHER_API_KEY",
};

// ── Model aliases (config shorthand → API model name) ──

const MODEL_ALIASES: Record<string, string> = {
  "deepseek-v3": "deepseek-ai/DeepSeek-V3",
};

// ── Key resolution ──

export function resolveApiKey(
  providerName: string,
  configKeys: Record<string, string | null>,
): string | null {
  const envVar = ENV_VAR_MAP[providerName];
  if (envVar) {
    const envValue = process.env[envVar];
    if (envValue && envValue.trim().length > 0) {
      return envValue.trim();
    }
  }
  const configValue = configKeys[providerName] ?? null;
  if (configValue && configValue.trim().length > 0) {
    return configValue.trim();
  }
  return null;
}

// ── Model name resolution ──

export function resolveModelName(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}

// ── Provider instantiation ──

export function createProvider(
  providerName: string,
  model: string,
  apiKey: string,
): Provider {
  const Ctor = PROVIDER_REGISTRY[providerName];
  if (!Ctor) {
    throw new Error(
      `Unknown provider "${providerName}". Available providers: ${Object.keys(PROVIDER_REGISTRY).join(", ")}`,
    );
  }
  return new Ctor(apiKey, resolveModelName(model));
}

// ── Initialize providers from config + CLI options ──

export function initProviders(
  config: Config,
  options: { model?: string },
): Provider[] {
  if (options.model) {
    return initSingleOverride(config, options.model);
  }
  return initFromConfig(config);
}

function initSingleOverride(config: Config, modelOverride: string): Provider[] {
  const entry = config.models.find((m) => m.model === modelOverride);
  if (!entry) {
    throw new Error(
      `Model "${modelOverride}" not found in config. Configured models: ${config.models.map((m) => m.model).join(", ")}`,
    );
  }

  const apiKey = resolveApiKey(entry.provider, config.keys);
  if (!apiKey) {
    const envVar = ENV_VAR_MAP[entry.provider] ?? `${entry.provider.toUpperCase()}_API_KEY`;
    throw new Error(
      `No API key for provider "${entry.provider}" (model "${modelOverride}"). Set ${envVar} or add it to config keys.`,
    );
  }

  return [createProvider(entry.provider, entry.model, apiKey)];
}

function initFromConfig(config: Config): Provider[] {
  const providers: Provider[] = [];

  for (const entry of config.models) {
    if (!PROVIDER_REGISTRY[entry.provider]) {
      throw new Error(
        `Unknown provider "${entry.provider}" in config models. Available providers: ${Object.keys(PROVIDER_REGISTRY).join(", ")}`,
      );
    }
    const apiKey = resolveApiKey(entry.provider, config.keys);
    if (!apiKey) {
      continue;
    }
    providers.push(createProvider(entry.provider, entry.model, apiKey));
  }

  if (providers.length === 0) {
    const envVars = [...new Set(
      config.models.map((m) => ENV_VAR_MAP[m.provider] ?? `${m.provider.toUpperCase()}_API_KEY`),
    )];
    throw new Error(
      `No providers available — no valid API keys found. Set at least one of: ${envVars.join(", ")}`,
    );
  }

  return providers.slice(0, config.ensemble.maxModels);
}
