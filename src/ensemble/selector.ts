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
    // Scored candidates rank above unscored; unscored carry no signal so they
    // sort last regardless of order. We compare margin only between scored
    // candidates; a slot with no scored candidates defers to the user.
    const scored = slot.candidates
      .filter((c): c is typeof c & { confidence: number } => c.confidence !== null)
      .sort((a, b) => b.confidence - a.confidence);
    const unscored = slot.candidates.filter((c) => c.confidence === null);

    if (scored.length === 0) {
      // No confidence signal anywhere — picking is arbitrary, so defer to user.
      return { slot, picked: unscored[0].model, reason: "user" as const, margin: 0 };
    }

    if (scored.length === 1) {
      // One scored candidate beats any number of unscored candidates outright.
      return { slot, picked: scored[0].model, reason: "auto" as const, margin: 1.0 };
    }

    const margin = scored[0].confidence - scored[1].confidence;
    return {
      slot,
      picked: scored[0].model,
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
