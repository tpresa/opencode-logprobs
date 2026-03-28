import type { Provider, Message, GenerationResult, Config } from "./providers/types.js";
import { TOOL_DEFS, executeTool, isReadOperation, type ToolName } from "./tools.js";
import { score, type Scores } from "./scoring.js";
import { runEnsemble, matchToolCalls, autoSelect, type Selection } from "./ensemble/index.js";
import { verify, type VerificationResult } from "./verification.js";

// ── Agent state ──

export interface AgentState {
  messages: Message[];
  mode: "single" | "ensemble";
  providers: Provider[];
  config: Config;
}

// ── Single-model turn ──

export interface SingleTurnResult {
  result: GenerationResult;
  scores: Scores;
}

export async function runSingleTurn(state: AgentState): Promise<SingleTurnResult> {
  const provider = state.providers[0];
  const result = await provider.generate(state.messages, TOOL_DEFS);
  const scores = score(result);
  return { result, scores };
}

// ── Ensemble turn ──

export interface EnsembleTurnResult {
  selections: Selection[];
  modelResults: Map<string, GenerationResult>;
  modelScores: Map<string, Scores>;
}

export async function runEnsembleTurn(state: AgentState): Promise<EnsembleTurnResult> {
  const ensemble = await runEnsemble(state.providers, state.messages, TOOL_DEFS);
  const slots = matchToolCalls(ensemble);
  const selections = autoSelect(slots, state.config.ensemble.selectionMargin);

  return {
    selections,
    modelResults: ensemble.results,
    modelScores: ensemble.scores,
  };
}

// ── Apply selected tool calls ──

export interface ApplyResult {
  executed: { slotKey: string; model: string; output: string; success: boolean }[];
  verification?: VerificationResult;
}

export async function applySelections(
  selections: Selection[],
  config: Config,
  cwd: string
): Promise<ApplyResult> {
  const executed: ApplyResult["executed"] = [];

  for (const sel of selections) {
    const candidate = sel.slot.candidates.find((c) => c.model === sel.picked);
    if (!candidate) continue;

    const tc = candidate.toolCall;

    // Skip read operations — they don't mutate state
    if (isReadOperation(tc.name)) continue;

    const result = await executeTool(tc.name as ToolName, tc.arguments);
    executed.push({
      slotKey: sel.slot.key,
      model: sel.picked,
      output: result.output,
      success: result.success,
    });
  }

  // Run verification if configured
  let verification: VerificationResult | undefined;
  if (config.verification.autoRun) {
    verification = await verify(
      cwd,
      config.verification.testCommand,
      config.verification.lintCommand
    );
  }

  return { executed, verification };
}

// ── Conversation helpers ──

export function addUserMessage(state: AgentState, content: string): void {
  state.messages.push({ role: "user", content });
}

export function addAssistantMessage(state: AgentState, result: GenerationResult): void {
  state.messages.push({
    role: "assistant",
    content: result.content,
    toolCalls: result.toolCalls,
  });
}

export function addToolResult(state: AgentState, toolCallId: string, output: string): void {
  state.messages.push({
    role: "tool",
    content: output,
    toolCallId,
  });
}
