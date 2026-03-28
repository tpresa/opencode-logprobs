import type { ToolCallSlot } from "./matcher.js";

// ── Selection result ──

export interface Selection {
  slot: ToolCallSlot;
  picked: string;             // model key
  reason: "auto" | "user";   // auto = clear winner, user = too close
  margin: number;             // gap between #1 and #2
}

// ── Auto-select the best candidate per slot ──

export function autoSelect(
  slots: ToolCallSlot[],
  marginThreshold = 0.10
): Selection[] {
  return slots.map((slot) => {
    const sorted = [...slot.candidates].sort((a, b) => b.confidence - a.confidence);

    if (sorted.length === 1) {
      return { slot, picked: sorted[0].model, reason: "auto" as const, margin: 1.0 };
    }

    const margin = sorted[0].confidence - sorted[1].confidence;
    return {
      slot,
      picked: sorted[0].model,
      reason: margin >= marginThreshold ? ("auto" as const) : ("user" as const),
      margin,
    };
  });
}

// ── User overrides a selection ──

export function swapPick(selections: Selection[], slotKey: string, newModel: string): Selection[] {
  return selections.map((sel) => {
    if (sel.slot.key === slotKey) {
      return { ...sel, picked: newModel, reason: "user" as const };
    }
    return sel;
  });
}
