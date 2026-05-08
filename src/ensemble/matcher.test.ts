import { describe, it, expect } from "vitest";
import { matchToolCalls, getSlotKey } from "./matcher.js";
import type { EnsembleResult } from "./runner.js";
import type { GenerationResult } from "../providers/types.js";
import type { Scores } from "../scoring.js";

function makeResult(
  toolCalls: GenerationResult["toolCalls"],
  overrides?: Partial<GenerationResult>
): GenerationResult {
  return {
    content: "",
    tokens: [],
    toolCalls,
    model: "test",
    provider: "test",
    usage: { input: 0, output: 0 },
    latencyMs: 0,
    ...overrides,
  };
}

function makeScores(toolCallScores: Record<string, number>): Scores {
  return {
    response: 0.8,
    toolCalls: new Map(Object.entries(toolCallScores)),
    files: new Map(),
  };
}

describe("getSlotKey", () => {
  it("uses path for write_file", () => {
    expect(getSlotKey({ id: "1", name: "write_file", arguments: { path: "src/a.ts" }, tokenRange: [0, 0] }))
      .toBe("write_file:src/a.ts");
  });

  it("uses path for edit_file", () => {
    expect(getSlotKey({ id: "2", name: "edit_file", arguments: { path: "src/b.ts" }, tokenRange: [0, 0] }))
      .toBe("edit_file:src/b.ts");
  });

  it("uses path for read_file", () => {
    expect(getSlotKey({ id: "3", name: "read_file", arguments: { path: "src/c.ts" }, tokenRange: [0, 0] }))
      .toBe("read_file:src/c.ts");
  });

  it("uses command for run_command", () => {
    expect(getSlotKey({ id: "4", name: "run_command", arguments: { command: "npm test" }, tokenRange: [0, 0] }))
      .toBe("run_command:npm test");
  });

  it("falls back to id for unknown tool", () => {
    expect(getSlotKey({ id: "5", name: "unknown_tool", arguments: {}, tokenRange: [0, 0] }))
      .toBe("unknown_tool:5");
  });
});

describe("matchToolCalls", () => {
  it("groups same-path tool calls from different models into one slot", () => {
    const ensemble: EnsembleResult = {
      results: new Map([
        ["openai:gpt-4.1", makeResult([
          { id: "a1", name: "write_file", arguments: { path: "src/auth.ts" }, tokenRange: [0, 5] },
        ])],
        ["google:gemini", makeResult([
          { id: "b1", name: "write_file", arguments: { path: "src/auth.ts" }, tokenRange: [0, 4] },
        ])],
      ]),
      scores: new Map([
        ["openai:gpt-4.1", makeScores({ a1: 0.85 })],
        ["google:gemini", makeScores({ b1: 0.72 })],
      ]),
    };

    const slots = matchToolCalls(ensemble);
    expect(slots).toHaveLength(1);
    expect(slots[0].key).toBe("write_file:src/auth.ts");
    expect(slots[0].candidates).toHaveLength(2);
    expect(slots[0].candidates[0].confidence).toBe(0.85);
    expect(slots[0].candidates[1].confidence).toBe(0.72);
  });

  it("creates separate slots for different file paths", () => {
    const ensemble: EnsembleResult = {
      results: new Map([
        ["modelA", makeResult([
          { id: "a1", name: "write_file", arguments: { path: "src/a.ts" }, tokenRange: [0, 1] },
        ])],
        ["modelB", makeResult([
          { id: "b1", name: "write_file", arguments: { path: "src/b.ts" }, tokenRange: [0, 1] },
        ])],
      ]),
      scores: new Map([
        ["modelA", makeScores({ a1: 0.9 })],
        ["modelB", makeScores({ b1: 0.8 })],
      ]),
    };

    const slots = matchToolCalls(ensemble);
    expect(slots).toHaveLength(2);

    const keys = slots.map((s) => s.key);
    expect(keys).toContain("write_file:src/a.ts");
    expect(keys).toContain("write_file:src/b.ts");
  });

  it("flags unique tool calls (only one model produces them)", () => {
    const ensemble: EnsembleResult = {
      results: new Map([
        ["modelA", makeResult([
          { id: "a1", name: "write_file", arguments: { path: "src/shared.ts" }, tokenRange: [0, 1] },
        ])],
        ["modelB", makeResult([
          { id: "b1", name: "write_file", arguments: { path: "src/shared.ts" }, tokenRange: [0, 1] },
          { id: "b2", name: "write_file", arguments: { path: "src/extra.ts" }, tokenRange: [1, 2] },
        ])],
      ]),
      scores: new Map([
        ["modelA", makeScores({ a1: 0.8 })],
        ["modelB", makeScores({ b1: 0.75, b2: 0.7 })],
      ]),
    };

    const slots = matchToolCalls(ensemble);
    const extraSlot = slots.find((s) => s.key === "write_file:src/extra.ts");
    expect(extraSlot).toBeDefined();
    expect(extraSlot!.candidates).toHaveLength(1);
    expect(extraSlot!.candidates[0].model).toBe("modelB");
  });

  it("handles empty ensemble results", () => {
    const ensemble: EnsembleResult = {
      results: new Map(),
      scores: new Map(),
    };

    const slots = matchToolCalls(ensemble);
    expect(slots).toHaveLength(0);
  });

  it("carries null confidence for tool calls absent from scores.toolCalls (no fake-zero coercion)", () => {
    const ensemble: EnsembleResult = {
      results: new Map([
        ["openai:gpt-4.1", makeResult([
          // tokenRange null marks this tool call as unscored at the provider layer
          { id: "a1", name: "write_file", arguments: { path: "src/a.ts" }, tokenRange: null },
        ])],
        ["google:gemini", makeResult([
          { id: "b1", name: "write_file", arguments: { path: "src/a.ts" }, tokenRange: [0, 3] },
        ])],
      ]),
      scores: new Map([
        // a1 deliberately absent — score() omits unscored tool calls from this map
        ["openai:gpt-4.1", makeScores({})],
        ["google:gemini", makeScores({ b1: 0.72 })],
      ]),
    };

    const slots = matchToolCalls(ensemble);
    expect(slots).toHaveLength(1);
    const candidates = slots[0].candidates;
    const openai = candidates.find((c) => c.model === "openai:gpt-4.1");
    const google = candidates.find((c) => c.model === "google:gemini");
    expect(openai?.confidence).toBeNull();
    expect(google?.confidence).toBe(0.72);
  });
});
