// ── Message types ──

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCallResult[];
}

// ── Token & logprob types ──

export interface TokenLogprob {
  token: string;
  logprob: number;
  offset: number;
}

// ── Tool definitions ──

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ── Generation results ──

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  tokenRange: [number, number];
}

export interface GenerationResult {
  content: string;
  tokens: TokenLogprob[];
  toolCalls: ToolCallResult[];
  model: string;
  provider: string;
  usage: { input: number; output: number };
  latencyMs: number;
}

// ── Provider interface ──

export interface Provider {
  id: string;
  supportsLogprobs: boolean;
  generate(messages: Message[], tools: ToolDef[]): Promise<GenerationResult>;
}

// ── Configuration ──

export interface ModelConfig {
  provider: string;
  model: string;
}

export interface Config {
  models: ModelConfig[];
  keys: Record<string, string | null>;
  ensemble: {
    enabled: boolean;
    selectionMargin: number;
    maxModels: number;
  };
  scoring: {
    aggregation: "mean" | "min" | "p10";
    flagThreshold: number;
    showScores: boolean;
  };
  verification: {
    autoRun: boolean;
    testCommand: string | null;
    lintCommand: string | null;
  };
  retry: {
    maxRetries: number;
    autoRetry: boolean;
  };
}

export const DEFAULT_CONFIG: Config = {
  models: [
    { provider: "openai", model: "gpt-4.1" },
    { provider: "google", model: "gemini-2.5-pro" },
    { provider: "together", model: "deepseek-v3" },
  ],
  keys: {
    openai: null,
    google: null,
    together: null,
  },
  ensemble: {
    enabled: false,
    selectionMargin: 0.10,
    maxModels: 3,
  },
  scoring: {
    aggregation: "mean",
    flagThreshold: 0.60,
    showScores: true,
  },
  verification: {
    autoRun: true,
    testCommand: null,
    lintCommand: null,
  },
  retry: {
    maxRetries: 2,
    autoRetry: false,
  },
};
