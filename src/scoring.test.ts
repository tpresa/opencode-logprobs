import { describe, it, expect } from "vitest";
import { aggregate, score, confidenceBar, formatConfidence, isFlagged } from "./scoring.js";
import type { GenerationResult } from "./providers/types.js";

describe("aggregate", () => {
  it("returns 0 for empty array", () => {
    expect(aggregate([])).toBe(0);
  });

  it("returns exp(mean(logprobs)) for a single value", () => {
    // exp(-0.5) ≈ 0.6065
    expect(aggregate([-0.5])).toBeCloseTo(Math.exp(-0.5), 5);
  });

  it("returns exp(mean(logprobs)) for multiple values", () => {
    const logprobs = [-0.1, -0.2, -0.3];
    const mean = (-0.1 + -0.2 + -0.3) / 3;
    expect(aggregate(logprobs)).toBeCloseTo(Math.exp(mean), 5);
  });

  it("returns 1.0 for all-zero logprobs (perfect confidence)", () => {
    expect(aggregate([0, 0, 0])).toBeCloseTo(1.0, 5);
  });

  it("returns value close to 0 for very negative logprobs", () => {
    expect(aggregate([-10, -10, -10])).toBeCloseTo(Math.exp(-10), 5);
  });
});

describe("score", () => {
  it("scores a result with no tool calls", () => {
    const result: GenerationResult = {
      content: "hello",
      tokens: [
        { token: "hello", logprob: -0.1, offset: 0 },
      ],
      toolCalls: [],
      model: "test",
      provider: "test",
      usage: { input: 10, output: 1 },
      latencyMs: 100,
    };

    const scores = score(result);
    expect(scores.response).not.toBeNull();
    expect(scores.response).toBeCloseTo(Math.exp(-0.1), 5);
    expect(scores.toolCalls.size).toBe(0);
    expect(scores.files.size).toBe(0);
  });

  it("returns null response score when no tokens have logprobs (e.g. OpenAI tool-call-only response)", () => {
    const result: GenerationResult = {
      content: "",
      tokens: [],
      toolCalls: [
        { id: "tc1", name: "write_file", arguments: { path: "x.ts", content: "y" }, tokenRange: null },
      ],
      model: "test",
      provider: "test",
      usage: { input: 10, output: 5 },
      latencyMs: 100,
    };

    const scores = score(result);
    expect(scores.response).toBeNull();
  });

  it("scores tool calls using their token ranges", () => {
    const result: GenerationResult = {
      content: "",
      tokens: [
        { token: "a", logprob: -0.1, offset: 0 },
        { token: "b", logprob: -0.2, offset: 1 },
        { token: "c", logprob: -0.5, offset: 2 },
        { token: "d", logprob: -0.8, offset: 3 },
        { token: "e", logprob: -0.05, offset: 4 },
      ],
      toolCalls: [
        { id: "tc1", name: "read_file", arguments: { path: "foo.ts" }, tokenRange: [0, 2] },
        { id: "tc2", name: "write_file", arguments: { path: "bar.ts", content: "x" }, tokenRange: [2, 5] },
      ],
      model: "test",
      provider: "test",
      usage: { input: 10, output: 5 },
      latencyMs: 200,
    };

    const scores = score(result);

    // tc1 uses tokens [0,2) → logprobs [-0.1, -0.2]
    const tc1Expected = Math.exp((-0.1 + -0.2) / 2);
    expect(scores.toolCalls.get("tc1")).toBeCloseTo(tc1Expected, 5);

    // tc2 uses tokens [2,5) → logprobs [-0.5, -0.8, -0.05]
    const tc2Expected = Math.exp((-0.5 + -0.8 + -0.05) / 3);
    expect(scores.toolCalls.get("tc2")).toBeCloseTo(tc2Expected, 5);
  });

  it("computes file scores for write_file and edit_file", () => {
    const result: GenerationResult = {
      content: "",
      tokens: [
        { token: "x", logprob: -0.3, offset: 0 },
        { token: "y", logprob: -0.4, offset: 1 },
      ],
      toolCalls: [
        { id: "tc1", name: "write_file", arguments: { path: "src/a.ts", content: "code" }, tokenRange: [0, 2] },
      ],
      model: "test",
      provider: "test",
      usage: { input: 5, output: 2 },
      latencyMs: 50,
    };

    const scores = score(result);
    expect(scores.files.has("src/a.ts")).toBe(true);
    expect(scores.files.get("src/a.ts")).toBeCloseTo(Math.exp((-0.3 + -0.4) / 2), 5);
  });

  it("does not compute file scores for read_file or run_command", () => {
    const result: GenerationResult = {
      content: "",
      tokens: [{ token: "x", logprob: -0.1, offset: 0 }],
      toolCalls: [
        { id: "tc1", name: "read_file", arguments: { path: "foo.ts" }, tokenRange: [0, 1] },
        { id: "tc2", name: "run_command", arguments: { command: "ls" }, tokenRange: [0, 1] },
      ],
      model: "test",
      provider: "test",
      usage: { input: 5, output: 1 },
      latencyMs: 50,
    };

    const scores = score(result);
    expect(scores.files.size).toBe(0);
  });

  it("omits unscored tool calls (tokenRange === null) from toolCallScores instead of emitting a fake 0", () => {
    const result: GenerationResult = {
      content: "",
      tokens: [{ token: "a", logprob: -0.1, offset: 0 }],
      toolCalls: [
        { id: "scored", name: "read_file", arguments: { path: "foo.ts" }, tokenRange: [0, 1] },
        { id: "unscored", name: "write_file", arguments: { path: "bar.ts", content: "x" }, tokenRange: null },
      ],
      model: "test",
      provider: "test",
      usage: { input: 5, output: 1 },
      latencyMs: 50,
    };

    const scores = score(result);
    expect(scores.toolCalls.has("scored")).toBe(true);
    expect(scores.toolCalls.has("unscored")).toBe(false);
    expect(scores.toolCalls.get("unscored")).toBeUndefined();
  });

  it("omits unscored write_file/edit_file from fileScores instead of emitting a fake 0", () => {
    const result: GenerationResult = {
      content: "",
      tokens: [],
      toolCalls: [
        { id: "tc1", name: "write_file", arguments: { path: "src/a.ts", content: "code" }, tokenRange: null },
        { id: "tc2", name: "edit_file", arguments: { path: "src/b.ts", old_content: "x", new_content: "y" }, tokenRange: null },
      ],
      model: "test",
      provider: "test",
      usage: { input: 5, output: 1 },
      latencyMs: 50,
    };

    const scores = score(result);
    expect(scores.files.size).toBe(0);
  });
});

describe("confidenceBar", () => {
  it("returns all filled blocks for confidence 1.0", () => {
    expect(confidenceBar(1.0, 10)).toBe("\u2588".repeat(10));
  });

  it("returns all empty blocks for confidence 0.0", () => {
    expect(confidenceBar(0.0, 10)).toBe("\u2591".repeat(10));
  });

  it("returns mixed blocks for intermediate confidence", () => {
    const bar = confidenceBar(0.5, 10);
    expect(bar.length).toBe(10);
    expect(bar).toBe("\u2588".repeat(5) + "\u2591".repeat(5));
  });
});

describe("formatConfidence", () => {
  it("formats to 2 decimal places", () => {
    expect(formatConfidence(0.8432)).toBe("0.84");
    expect(formatConfidence(1.0)).toBe("1.00");
    expect(formatConfidence(0)).toBe("0.00");
  });
});

describe("isFlagged", () => {
  it("flags scores below threshold", () => {
    expect(isFlagged(0.5, 0.6)).toBe(true);
  });

  it("does not flag scores at or above threshold", () => {
    expect(isFlagged(0.6, 0.6)).toBe(false);
    expect(isFlagged(0.9, 0.6)).toBe(false);
  });

  it("uses default threshold of 0.60", () => {
    expect(isFlagged(0.59)).toBe(true);
    expect(isFlagged(0.60)).toBe(false);
  });
});
