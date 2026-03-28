import type { Provider, Message, ToolDef, GenerationResult } from "./providers/types.js";
import { score, type Scores } from "./scoring.js";

// ── Retry a specific tool call with one or all providers ──

export interface RetryRequest {
  slotKey: string;
  providers: Provider[];  // one specific provider or all
  messages: Message[];
  tools: ToolDef[];
  context: string;        // additional context about what went wrong
}

export interface RetryResult {
  model: string;
  result: GenerationResult;
  scores: Scores;
}

export async function retryToolCall(request: RetryRequest): Promise<RetryResult[]> {
  const { providers, messages, tools, context } = request;

  // Append retry context to messages
  const retryMessages: Message[] = [
    ...messages,
    {
      role: "user",
      content: `The previous output for this tool call had low confidence. ${context} Please try again with a more careful approach.`,
    },
  ];

  const runs = providers.map(async (p) => {
    const result = await p.generate(retryMessages, tools);
    const scores = score(result);
    return { model: `${p.id}:${result.model}`, result, scores };
  });

  const settled = await Promise.allSettled(runs);
  const results: RetryResult[] = [];

  for (const s of settled) {
    if (s.status === "fulfilled") {
      results.push(s.value);
    }
  }

  return results;
}
