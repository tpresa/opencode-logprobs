import type { ToolCallResult } from "../providers/types.js";
import type { EnsembleResult } from "./runner.js";

// ── Slot: a logical "position" that groups the same tool call across models ──

export interface ToolCallSlot {
  key: string;  // e.g. "write_file:src/auth.ts"
  candidates: ToolCallCandidate[];
}

export interface ToolCallCandidate {
  model: string;
  toolCall: ToolCallResult;
  confidence: number;
}

// ── Match tool calls across models into slots ──

export function matchToolCalls(ensemble: EnsembleResult): ToolCallSlot[] {
  const slots = new Map<string, ToolCallSlot>();

  for (const [modelKey, result] of ensemble.results) {
    for (const tc of result.toolCalls) {
      const slotKey = getSlotKey(tc);

      if (!slots.has(slotKey)) {
        slots.set(slotKey, { key: slotKey, candidates: [] });
      }

      const modelScores = ensemble.scores.get(modelKey);
      const confidence = modelScores?.toolCalls.get(tc.id) ?? 0;

      slots.get(slotKey)!.candidates.push({
        model: modelKey,
        toolCall: tc,
        confidence,
      });
    }
  }

  return Array.from(slots.values());
}

// ── Derive a slot key from a tool call ──

export function getSlotKey(tc: ToolCallResult): string {
  switch (tc.name) {
    case "write_file":
    case "edit_file":
    case "read_file":
      return `${tc.name}:${tc.arguments.path}`;
    case "run_command":
      return `${tc.name}:${tc.arguments.command}`;
    default:
      return `${tc.name}:${tc.id}`;
  }
}
