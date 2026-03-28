import type { Provider, GenerationResult, Message, ToolDef } from "../providers/types.js";
import { score, type Scores } from "../scoring.js";

// ── Ensemble result ──

export interface EnsembleResult {
  results: Map<string, GenerationResult>;  // "provider:model" → result
  scores: Map<string, Scores>;             // "provider:model" → scores
}

// ── Run all providers in parallel ──

export async function runEnsemble(
  providers: Provider[],
  messages: Message[],
  tools: ToolDef[]
): Promise<EnsembleResult> {
  const runs = providers.map(async (p) => {
    const result = await p.generate(messages, tools);
    const scores = score(result);
    return { key: `${p.id}:${result.model}`, result, scores };
  });

  const settled = await Promise.allSettled(runs);

  const results = new Map<string, GenerationResult>();
  const scores = new Map<string, Scores>();

  for (const s of settled) {
    if (s.status === "fulfilled") {
      results.set(s.value.key, s.value.result);
      scores.set(s.value.key, s.value.scores);
    } else {
      // Log failures but don't block — ensemble degrades gracefully
      console.error(`Provider failed: ${s.reason}`);
    }
  }

  return { results, scores };
}
