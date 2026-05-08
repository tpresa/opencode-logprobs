import { describe, it, expect } from "vitest";
import { autoSelect, swapPick } from "./selector.js";
import type { ToolCallSlot } from "./matcher.js";

function makeSlot(key: string, candidates: { model: string; confidence: number | null }[]): ToolCallSlot {
  return {
    key,
    candidates: candidates.map((c) => ({
      model: c.model,
      toolCall: { id: `${c.model}-tc`, name: "write_file", arguments: { path: key }, tokenRange: c.confidence === null ? null : [0, 0] as [number, number] },
      confidence: c.confidence,
    })),
  };
}

describe("autoSelect", () => {
  it("auto-selects when margin exceeds threshold", () => {
    const slots = [
      makeSlot("src/a.ts", [
        { model: "gpt-4.1", confidence: 0.90 },
        { model: "gemini", confidence: 0.75 },
      ]),
    ];

    const selections = autoSelect(slots, 0.10);
    expect(selections).toHaveLength(1);
    expect(selections[0].picked).toBe("gpt-4.1");
    expect(selections[0].reason).toBe("auto");
    expect(selections[0].margin).toBeCloseTo(0.15, 5);
  });

  it("defers to user when margin is below threshold", () => {
    const slots = [
      makeSlot("src/b.ts", [
        { model: "gpt-4.1", confidence: 0.82 },
        { model: "gemini", confidence: 0.78 },
      ]),
    ];

    const selections = autoSelect(slots, 0.10);
    expect(selections[0].picked).toBe("gpt-4.1");
    expect(selections[0].reason).toBe("user");
    expect(selections[0].margin).toBeCloseTo(0.04, 5);
  });

  it("auto-selects single candidate with margin 1.0", () => {
    const slots = [
      makeSlot("src/c.ts", [
        { model: "deepseek", confidence: 0.70 },
      ]),
    ];

    const selections = autoSelect(slots, 0.10);
    expect(selections[0].picked).toBe("deepseek");
    expect(selections[0].reason).toBe("auto");
    expect(selections[0].margin).toBe(1.0);
  });

  it("handles exactly-at-threshold margin as auto", () => {
    const slots = [
      makeSlot("src/d.ts", [
        { model: "modelA", confidence: 0.80 },
        { model: "modelB", confidence: 0.70 },
      ]),
    ];

    const selections = autoSelect(slots, 0.10);
    expect(selections[0].reason).toBe("auto");
  });

  it("selects across multiple slots independently", () => {
    const slots = [
      makeSlot("src/x.ts", [
        { model: "A", confidence: 0.95 },
        { model: "B", confidence: 0.60 },
      ]),
      makeSlot("src/y.ts", [
        { model: "A", confidence: 0.50 },
        { model: "B", confidence: 0.85 },
      ]),
    ];

    const selections = autoSelect(slots, 0.10);
    expect(selections[0].picked).toBe("A");
    expect(selections[1].picked).toBe("B");
  });

  it("defers to user when every candidate is unscored (no fake-zero ranking)", () => {
    const slots = [
      makeSlot("src/all-unscored.ts", [
        { model: "openai", confidence: null },
        { model: "google", confidence: null },
      ]),
    ];

    const selections = autoSelect(slots, 0.10);
    expect(selections[0].reason).toBe("user");
    expect(selections[0].margin).toBe(0);
    expect(selections[0].picked).toBe("openai");
  });

  it("auto-picks the only scored candidate over unscored candidates", () => {
    const slots = [
      makeSlot("src/mixed.ts", [
        { model: "openai", confidence: null },
        { model: "google", confidence: 0.40 },
      ]),
    ];

    const selections = autoSelect(slots, 0.10);
    expect(selections[0].picked).toBe("google");
    expect(selections[0].reason).toBe("auto");
    expect(selections[0].margin).toBe(1.0);
  });

  it("ranks scored candidates against each other and ignores unscored when computing margin", () => {
    const slots = [
      makeSlot("src/mixed-multi.ts", [
        { model: "openai", confidence: null },
        { model: "google", confidence: 0.85 },
        { model: "together", confidence: 0.82 },
      ]),
    ];

    // 0.85 vs 0.82 → margin 0.03 < 0.10 → user pick. The unscored openai
    // candidate must not be treated as 0 (which would inflate margin to 0.85).
    const selections = autoSelect(slots, 0.10);
    expect(selections[0].picked).toBe("google");
    expect(selections[0].reason).toBe("user");
    expect(selections[0].margin).toBeCloseTo(0.03, 5);
  });

  it("defers to user for a single unscored candidate (no signal to back the pick)", () => {
    const slots = [
      makeSlot("src/lone-unscored.ts", [
        { model: "openai", confidence: null },
      ]),
    ];

    const selections = autoSelect(slots, 0.10);
    expect(selections[0].picked).toBe("openai");
    expect(selections[0].reason).toBe("user");
    expect(selections[0].margin).toBe(0);
  });
});

describe("swapPick", () => {
  it("overrides the pick for a specific slot", () => {
    const slots = [
      makeSlot("src/a.ts", [
        { model: "gpt-4.1", confidence: 0.90 },
        { model: "gemini", confidence: 0.75 },
      ]),
    ];

    const original = autoSelect(slots, 0.10);
    expect(original[0].picked).toBe("gpt-4.1");

    const swapped = swapPick(original, "src/a.ts", "gemini");
    expect(swapped[0].picked).toBe("gemini");
    expect(swapped[0].reason).toBe("user");
  });

  it("does not affect other slots", () => {
    const slots = [
      makeSlot("src/a.ts", [
        { model: "A", confidence: 0.90 },
        { model: "B", confidence: 0.70 },
      ]),
      makeSlot("src/b.ts", [
        { model: "A", confidence: 0.80 },
        { model: "B", confidence: 0.60 },
      ]),
    ];

    const original = autoSelect(slots, 0.10);
    const swapped = swapPick(original, "src/a.ts", "B");

    expect(swapped[0].picked).toBe("B");
    expect(swapped[1].picked).toBe("A"); // unchanged
  });
});
