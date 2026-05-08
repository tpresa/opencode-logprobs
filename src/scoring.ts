import type { GenerationResult, ToolCallResult, TokenLogprob } from "./providers/types.js";

// ── Score types ──

export interface Scores {
  response: number;
  toolCalls: Map<string, number>;  // tool call ID → confidence
  files: Map<string, number>;      // file path → confidence
}

// ── Main scoring function ──

export function score(result: GenerationResult): Scores {
  const responseScore = aggregate(result.tokens.map((t) => t.logprob));

  const toolCallScores = new Map<string, number>();
  for (const tc of result.toolCalls) {
    if (tc.tokenRange === null) continue; // unscored — no logprobs available
    const [start, end] = tc.tokenRange;
    const tcTokens = result.tokens.slice(start, end);
    toolCallScores.set(tc.id, aggregate(tcTokens.map((t) => t.logprob)));
  }

  const fileScores = new Map<string, number>();
  for (const tc of result.toolCalls) {
    if (tc.tokenRange === null) continue;
    if (tc.name === "write_file" || tc.name === "edit_file") {
      const filePath = tc.arguments.path as string;
      const contentTokens = extractContentTokens(tc, result.tokens);
      fileScores.set(filePath, aggregate(contentTokens.map((t) => t.logprob)));
    }
  }

  return { response: responseScore, toolCalls: toolCallScores, files: fileScores };
}

// ── Aggregation ──

export function aggregate(logprobs: number[]): number {
  if (logprobs.length === 0) return 0;
  const mean = logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
  return Math.exp(mean);
}

// ── Helpers ──

export function extractContentTokens(
  tc: ToolCallResult,
  tokens: TokenLogprob[]
): TokenLogprob[] {
  // Extract tokens belonging to the file content within a write_file/edit_file call.
  // For now, we use the full token range of the tool call as an approximation.
  // TODO: refine to only include tokens for the `content` / `new_content` argument.
  if (tc.tokenRange === null) return [];
  const [start, end] = tc.tokenRange;
  return tokens.slice(start, end);
}

// ── Display helpers ──

export function confidenceBar(confidence: number, width = 10): string {
  const filled = Math.round(confidence * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}

export function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}

export function isFlagged(confidence: number, threshold = 0.60): boolean {
  return confidence < threshold;
}
