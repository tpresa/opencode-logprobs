#!/usr/bin/env node

import { program } from "commander";
import chalk from "chalk";
import {
  type AgentState,
  runSingleTurn,
  runEnsembleTurn,
  applySelections,
  addUserMessage,
} from "./agent.js";
import { confidenceBar, formatConfidence, isFlagged } from "./scoring.js";
import { swapPick, type Selection } from "./ensemble/index.js";
import type { Provider, Config, GenerationResult } from "./providers/types.js";
import type { Scores } from "./scoring.js";
import { DEFAULT_CONFIG } from "./providers/types.js";
import { createInterface } from "node:readline";

// ── CLI entry point ──

program
  .name("conf-agent")
  .description("AI coding agent with logprob-based confidence scoring")
  .version("0.1.0")
  .argument("[prompt]", "The task to perform")
  .option("--ensemble", "Run in ensemble mode (multiple models in parallel)")
  .option("--model <model>", "Override primary model")
  .option("--config <path>", "Path to config file")
  .action(async (prompt: string | undefined, options: CLIOptions) => {
    if (!prompt) {
      program.help();
      return;
    }
    await run(prompt, options);
  });

program.parse();

// ── Types ──

interface CLIOptions {
  ensemble?: boolean;
  model?: string;
  config?: string;
}

// ── Main run loop ──

async function run(prompt: string, options: CLIOptions): Promise<void> {
  const config = await loadConfig(options.config);
  const providers = await initProviders(config, options);
  const mode = options.ensemble || config.ensemble.enabled ? "ensemble" : "single";

  const state: AgentState = {
    messages: [{ role: "user", content: prompt }],
    mode,
    providers,
    config,
  };

  console.log(chalk.bold(`\nconf-agent v0.1.0`));
  console.log(chalk.dim(`Mode: ${mode} | Models: ${providers.map((p) => p.id).join(", ")}\n`));

  if (mode === "single") {
    await singleModeLoop(state);
  } else {
    await ensembleModeLoop(state);
  }
}

// ── Single mode ──

async function singleModeLoop(state: AgentState): Promise<void> {
  const { result, scores } = await runSingleTurn(state);
  displaySingleResult(result, scores, state.config);

  const action = await promptAction(["a", "s", "r", "i", "q"], "[a]pply all  [s]kip flagged  [r]etry flagged  [i]nspect  [q]uit");

  switch (action) {
    case "a": {
      // Build a minimal Selection[] from single-model result for applySelections
      const selections = buildSingleSelections(result, scores);
      const applied = await applySelections(selections, state.config, process.cwd());
      displayApplyResult(applied);
      break;
    }
    case "r":
      // TODO: implement retry flow
      console.log(chalk.yellow("Retry not yet implemented."));
      break;
    case "i":
      // TODO: implement inspect view
      console.log(chalk.yellow("Inspect not yet implemented."));
      break;
    case "q":
      process.exit(0);
  }
}

// ── Ensemble mode ──

async function ensembleModeLoop(state: AgentState): Promise<void> {
  const { selections, modelResults, modelScores } = await runEnsembleTurn(state);
  displayEnsembleResult(selections, modelResults, modelScores, state.config);

  const action = await promptAction(
    ["a", "c", "s", "i", "q"],
    "[a]pply selected  [c]ompare  [s]wap pick  [i]nspect  [q]uit"
  );

  switch (action) {
    case "a": {
      const applied = await applySelections(selections, state.config, process.cwd());
      displayApplyResult(applied);
      break;
    }
    case "c":
      // TODO: implement compare view
      console.log(chalk.yellow("Compare not yet implemented."));
      break;
    case "s":
      // TODO: implement swap pick flow
      console.log(chalk.yellow("Swap not yet implemented."));
      break;
    case "i":
      // TODO: implement inspect view
      console.log(chalk.yellow("Inspect not yet implemented."));
      break;
    case "q":
      process.exit(0);
  }
}

// ── Display functions ──

function displaySingleResult(result: GenerationResult, scores: Scores, config: Config): void {
  const threshold = config.scoring.flagThreshold;

  console.log(
    chalk.bold(`\n🤖 ${result.model}`) +
    chalk.dim(` — overall confidence: ${formatConfidence(scores.response)} ${confidenceBar(scores.response)}`)
  );

  console.log(chalk.dim("\n  Tool calls:"));
  for (const tc of result.toolCalls) {
    const conf = scores.toolCalls.get(tc.id) ?? 0;
    const flag = isFlagged(conf, threshold) ? chalk.yellow(" ⚠️") : "";
    const args = tc.name === "write_file" || tc.name === "edit_file" || tc.name === "read_file"
      ? ` ${tc.arguments.path}`
      : tc.name === "run_command"
        ? ` ${tc.arguments.command}`
        : "";

    console.log(
      `    ${tc.name}${args}`.padEnd(50) +
      `${formatConfidence(conf)} ${confidenceBar(conf)}${flag}`
    );
  }

  const flagged = result.toolCalls.filter((tc) => isFlagged(scores.toolCalls.get(tc.id) ?? 0, threshold));
  if (flagged.length > 0) {
    console.log(chalk.yellow(`\n  ⚠️  ${flagged.length} tool call(s) have low confidence.`));
  }
}

function displayEnsembleResult(
  selections: Selection[],
  _modelResults: Map<string, GenerationResult>,
  modelScores: Map<string, Scores>,
  _config: Config
): void {
  // Overall scores per model
  const models = Array.from(modelScores.entries());
  console.log(
    chalk.bold("\n🤖 Ensemble: ") +
    models.map(([key, s]) => `${key} ${formatConfidence(s.response)}`).join(" | ")
  );

  // Per-slot display
  for (const sel of selections) {
    const border = chalk.dim("─".repeat(60));
    console.log(`\n  ┌${border}┐`);
    console.log(`  │ ${chalk.bold(sel.slot.key)}`.padEnd(65) + "│");

    for (const c of sel.slot.candidates) {
      const selected = c.model === sel.picked ? chalk.green(" ← selected") : "";
      const userPick = sel.reason === "user" && c.model === sel.picked
        ? chalk.yellow("  (within margin, user pick)")
        : "";
      console.log(
        `  │   ${c.model}`.padEnd(25) +
        `${formatConfidence(c.confidence)} ${confidenceBar(c.confidence)}${selected}${userPick}`.padEnd(40) +
        "│"
      );
    }

    if (sel.slot.candidates.length === 1) {
      console.log(`  │   ${chalk.dim("(unique to " + sel.slot.candidates[0].model + ")")}`.padEnd(65) + "│");
    }

    console.log(`  └${border}┘`);
  }

  const autoCount = selections.filter((s) => s.reason === "auto").length;
  const userCount = selections.filter((s) => s.reason === "user").length;
  console.log(chalk.dim(`\n  Auto-selected: ${autoCount} | Needs user pick: ${userCount}`));
}

function displayApplyResult(applied: Awaited<ReturnType<typeof applySelections>>): void {
  console.log(chalk.bold("\nApplied:"));
  for (const exec of applied.executed) {
    const status = exec.success ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${status} ${exec.slotKey} (${exec.model})`);
  }

  if (applied.verification) {
    const v = applied.verification;
    console.log(chalk.bold("\nVerification:"));
    console.log(`  ${v.passed ? chalk.green("✓ Passed") : chalk.red("✗ Failed")}`);
    if (v.testOutput) console.log(chalk.dim(`  Tests: ${v.testOutput.slice(0, 200)}`));
    if (v.lintOutput) console.log(chalk.dim(`  Lint: ${v.lintOutput.slice(0, 200)}`));
  }
}

// ── Input helpers ──

function promptAction(validKeys: string[], label: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${label}\n  > `, (answer) => {
      rl.close();
      const key = answer.trim().toLowerCase();
      if (validKeys.includes(key)) {
        resolve(key);
      } else {
        resolve("q");
      }
    });
  });
}

// ── Config loading ──

async function loadConfig(_path?: string): Promise<Config> {
  // TODO: load from ~/.config/conf-agent/config.json or provided path via cosmiconfig
  return DEFAULT_CONFIG;
}

// ── Provider initialization ──

async function initProviders(config: Config, options: CLIOptions): Promise<Provider[]> {
  // TODO: instantiate providers based on config and available API keys
  // For now, return empty — will be wired in M1
  console.log(chalk.yellow("⚠ Provider initialization not yet implemented — using stubs."));
  return [];
}

// ── Helpers ──

function buildSingleSelections(result: GenerationResult, scores: Scores): Selection[] {
  const modelKey = `${result.provider}:${result.model}`;
  return result.toolCalls.map((tc) => ({
    slot: {
      key: `${tc.name}:${tc.arguments.path ?? tc.arguments.command ?? tc.id}`,
      candidates: [{
        model: modelKey,
        toolCall: tc,
        confidence: scores.toolCalls.get(tc.id) ?? 0,
      }],
    },
    picked: modelKey,
    reason: "auto" as const,
    margin: 1.0,
  }));
}
