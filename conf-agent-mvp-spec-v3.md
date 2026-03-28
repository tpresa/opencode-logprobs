# conf-agent — MVP Spec v3

## Problem

AI coding agents treat model output as a black box. You get code, you accept or reject it, and you have no signal about how confident the model actually was. Every tool call, every file edit, every response — you're flying blind on reliability.

Worse, every agent is locked to a single model. But frontier models have complementary strengths — they fail on different things. Sup AI proved this on general reasoning: an ensemble of models with low error correlation beats any individual model by 7+ points. Code is an even better domain for this because tool calls provide natural boundaries for scoring and selection, and you can verify results by running the code.

## Solution

A terminal coding agent that:

1. Runs multiple models in parallel on the same task.
2. Scores each model's output using logprob-based confidence at three granularities: response level, tool call level, and file level.
3. Selects the best model's output per tool call based on confidence, or lets the user choose.

No AST parsing. No fragment merging. The unit of selection is the tool call — the agent picks which model's `write_file` to use, not which model's line 14 to use.

## Non-Goals

- AST-level or line-level scoring.
- Fragment synthesis / cross-model merging (taking line 5 from model A and line 12 from model B).
- GUI / editor integration.
- Project memory / RAG.

---

## How It Works

### Modes

The agent operates in two modes:

**Single mode** — one model, scored. The baseline experience. Useful when cost/latency matters or the task is simple.

**Ensemble mode** — N models in parallel (default 3), each scored independently, best output selected per tool call. Activated by flag (`--ensemble`) or config default.

### Scoring

Each model returns logprobs per token. We aggregate at coarse boundaries:

```
Response confidence = aggregate(all token logprobs in the response)
Tool call confidence = aggregate(token logprobs within that tool call's output)
File confidence     = aggregate(token logprobs for tokens belonging to that file's content)
```

Aggregation function (configurable, default `mean`):

```
C = exp(mean(logprob_1, logprob_2, ..., logprob_n))
```

No tree-sitter, no AST nodes, no structural weighting.

### Ensemble Selection

In ensemble mode, all models receive the same prompt and tools. Each model independently produces a sequence of tool calls. The agent then selects per tool call:

```
For each tool call position (e.g., "write src/middleware/auth.ts"):
  1. Find the corresponding tool call from each model's output
     (matched by tool name + file path, not by position index)
  2. Rank by confidence score
  3. Auto-select the highest confidence, or present to user if scores are close
```

"Close" means the top two scores differ by less than a configurable margin (default 0.10). When close, the user decides — the confidence delta isn't strong enough to choose automatically.

### Matching Tool Calls Across Models

Models won't produce identical tool call sequences. Model A might write 3 files, Model B might write 4. The matching logic:

- **write_file / edit_file**: match by file path. If Model A writes `src/auth.ts` and Model B writes `src/auth.ts`, they're the same slot.
- **run_command**: match by command intent (exact string match first, then prefix match).
- **read_file / list_files**: these are inputs, not outputs — no selection needed. Execute all unique reads and feed results to all models.
- **Unmatched tool calls**: if only one model writes a particular file, it's flagged as "unique to Model X" for user review. Could be a good idea (Model A caught an edge case) or a bad idea (Model B hallucinated a file).

### Display — Single Mode

```
$ conf-agent "Add rate limiting middleware"

🤖 gpt-4.1 — overall confidence: 0.84 ████████░░

  Tool calls:
    1. read_file src/app.ts                          0.97 ██████████
    2. write_file src/middleware/rateLimit.ts         0.62 ██████░░░░ ⚠️
    3. edit_file src/app.ts (add import)             0.88 █████████░

  ⚠️ Tool call #2 has low confidence.

  [a]pply all  [s]kip flagged  [r]etry flagged  [i]nspect  [q]uit
```

### Display — Ensemble Mode

```
$ conf-agent --ensemble "Add rate limiting middleware"

🤖 Ensemble: gpt-4.1 / gemini-2.5-pro / deepseek-v3
   Overall: gpt-4.1 0.84 | gemini 0.79 | deepseek 0.81

  ┌─────────────────────────────────────────────────────────────────┐
  │ write_file src/middleware/rateLimit.ts                          │
  │                                                                 │
  │   gpt-4.1        0.62 ██████░░░░                               │
  │   gemini-2.5-pro 0.78 ████████░░ ← selected                   │
  │   deepseek-v3    0.71 ███████░░░                               │
  └─────────────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────────────┐
  │ edit_file src/app.ts (add import)                               │
  │                                                                 │
  │   gpt-4.1        0.88 █████████░ ← selected                   │
  │   gemini-2.5-pro 0.85 █████████░    (within margin, user pick) │
  │   deepseek-v3    0.72 ███████░░░                               │
  └─────────────────────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────────────────────┐
  │ write_file src/middleware/errorHandler.ts                        │
  │                                                                 │
  │   gpt-4.1        —                                              │
  │   gemini-2.5-pro —                                              │
  │   deepseek-v3    0.74 ███████░░░    (unique to deepseek)        │
  └─────────────────────────────────────────────────────────────────┘

  Selected: 1 from gemini, 1 from gpt-4.1, 1 unique (deepseek)

  [a]pply selected  [c]ompare  [s]wap pick  [i]nspect  [q]uit
```

### Compare

User presses `c` and selects a tool call. The agent shows a side-by-side (or sequential) diff of each model's output for that slot:

```
Comparing: write_file src/middleware/rateLimit.ts

  ─── gpt-4.1 (0.62) ──────────────────────────────────
  import rateLimit from 'express-rate-limit';
  export const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  });

  ─── gemini-2.5-pro (0.78) ← selected ────────────────
  import { rateLimit } from 'express-rate-limit';
  export const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });

  ─── deepseek-v3 (0.71) ──────────────────────────────
  import rateLimit from 'express-rate-limit';
  export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });

  [1] Pick gpt-4.1  [2] Pick gemini  [3] Pick deepseek  [b]ack
```

### Swap Pick

User presses `s` to override the auto-selection for any tool call. The agent re-displays the ensemble view with the updated selection.

### Retry in Ensemble Mode

When the user presses `r`, the agent retries only the flagged tool calls — but now it can retry with a *specific model* or all models:

```
⚠️ All models scored below threshold for write_file src/auth.ts

  gpt-4.1   0.45 | gemini 0.51 | deepseek 0.48

  [a]ll models retry  [1] retry gpt-4.1  [2] retry gemini  [3] retry deepseek  [b]ack
```

---

## Technical Design

### Components

```
conf-agent/
├── src/
│   ├── cli.ts                # Terminal UI (prompt, scores, key handling)
│   ├── agent.ts              # Agentic loop: prompt → generate → score → select → apply
│   ├── providers/
│   │   ├── types.ts          # Provider interface
│   │   ├── openai.ts         # OpenAI (gpt-4.1, gpt-4o)
│   │   ├── google.ts         # Google (gemini-2.5-pro)
│   │   └── together.ts       # Together (deepseek, llama, etc.)
│   ├── scoring.ts            # Logprob aggregation at response/tool/file level
│   ├── ensemble/
│   │   ├── runner.ts         # Parallel model execution
│   │   ├── matcher.ts        # Match tool calls across models by path/intent
│   │   └── selector.ts       # Pick best output per tool call slot
│   ├── tools.ts              # Tool definitions (read_file, write_file, etc.)
│   ├── retry.ts              # Targeted re-generation of low-confidence tool calls
│   └── verification.ts       # Post-apply: run tests/lint if available
├── package.json
└── tsconfig.json
```

### Provider Interface

```typescript
interface TokenLogprob {
  token: string;
  logprob: number;
  offset: number;
}

interface GenerationResult {
  content: string;
  tokens: TokenLogprob[];
  toolCalls: ToolCallResult[];
  model: string;
  provider: string;
  usage: { input: number; output: number };
  latencyMs: number;
}

interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, any>;
  tokenRange: [number, number];
}

interface Provider {
  id: string;
  generate(messages: Message[], tools: ToolDef[]): Promise<GenerationResult>;
  supportsLogprobs: boolean;
}
```

### Scoring

```typescript
interface Scores {
  response: number;
  toolCalls: Map<string, number>;    // tool call ID → confidence
  files: Map<string, number>;        // file path → confidence
}

function score(result: GenerationResult): Scores {
  const responseScore = aggregate(result.tokens.map(t => t.logprob));

  const toolCallScores = new Map();
  for (const tc of result.toolCalls) {
    const [start, end] = tc.tokenRange;
    const tcTokens = result.tokens.slice(start, end);
    toolCallScores.set(tc.id, aggregate(tcTokens.map(t => t.logprob)));
  }

  const fileScores = new Map();
  for (const tc of result.toolCalls) {
    if (tc.name === 'write_file' || tc.name === 'edit_file') {
      const filePath = tc.arguments.path;
      const contentTokens = extractContentTokens(tc, result.tokens);
      fileScores.set(filePath, aggregate(contentTokens.map(t => t.logprob)));
    }
  }

  return { response: responseScore, toolCalls: toolCallScores, files: fileScores };
}

function aggregate(logprobs: number[]): number {
  if (logprobs.length === 0) return 0;
  const mean = logprobs.reduce((a, b) => a + b, 0) / logprobs.length;
  return Math.exp(mean);
}
```

### Ensemble Runner

```typescript
interface EnsembleResult {
  results: Map<string, GenerationResult>;  // provider:model → result
  scores: Map<string, Scores>;             // provider:model → scores
}

async function runEnsemble(
  providers: Provider[],
  messages: Message[],
  tools: ToolDef[]
): Promise<EnsembleResult> {
  // Run all providers in parallel
  const runs = providers.map(async (p) => {
    const result = await p.generate(messages, tools);
    const scores = score(result);
    return { key: `${p.id}:${result.model}`, result, scores };
  });

  const settled = await Promise.allSettled(runs);

  const results = new Map();
  const scores = new Map();
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.set(s.value.key, s.value.result);
      scores.set(s.value.key, s.value.scores);
    }
    // Log failures but don't block — ensemble degrades gracefully
  }

  return { results, scores };
}
```

### Tool Call Matcher

```typescript
interface ToolCallSlot {
  key: string;                          // e.g., "write_file:src/auth.ts"
  candidates: {
    model: string;
    toolCall: ToolCallResult;
    confidence: number;
  }[];
}

function matchToolCalls(ensemble: EnsembleResult): ToolCallSlot[] {
  const slots = new Map<string, ToolCallSlot>();

  for (const [modelKey, result] of ensemble.results) {
    for (const tc of result.toolCalls) {
      const slotKey = getSlotKey(tc);
      if (!slots.has(slotKey)) {
        slots.set(slotKey, { key: slotKey, candidates: [] });
      }
      const confidence = ensemble.scores.get(modelKey)!.toolCalls.get(tc.id)!;
      slots.get(slotKey)!.candidates.push({
        model: modelKey,
        toolCall: tc,
        confidence,
      });
    }
  }

  return Array.from(slots.values());
}

function getSlotKey(tc: ToolCallResult): string {
  switch (tc.name) {
    case 'write_file':
    case 'edit_file':
    case 'read_file':
      return `${tc.name}:${tc.arguments.path}`;
    case 'run_command':
      return `${tc.name}:${tc.arguments.command}`;
    default:
      return `${tc.name}:${tc.id}`;
  }
}
```

### Selector

```typescript
interface Selection {
  slot: ToolCallSlot;
  picked: string;               // model key
  reason: 'auto' | 'user';     // auto = clear winner, user = too close
  margin: number;               // gap between #1 and #2
}

function autoSelect(
  slots: ToolCallSlot[],
  marginThreshold: number = 0.10
): Selection[] {
  return slots.map(slot => {
    const sorted = [...slot.candidates].sort((a, b) => b.confidence - a.confidence);

    if (sorted.length === 1) {
      return { slot, picked: sorted[0].model, reason: 'auto', margin: 1.0 };
    }

    const margin = sorted[0].confidence - sorted[1].confidence;
    return {
      slot,
      picked: sorted[0].model,
      reason: margin >= marginThreshold ? 'auto' : 'user',
      margin,
    };
  });
}
```

### Providers Without Logprobs

Not all providers expose logprobs (notably Anthropic). Fallback strategies:

| Provider   | Logprobs | Fallback |
|------------|----------|----------|
| OpenAI     | Yes      | — |
| Google     | Yes      | — |
| Together   | Yes      | — |
| Groq       | Yes      | — |
| Anthropic  | No       | Consistency scoring (see below) |
| Local/Ollama | Varies | vLLM exposes full logprobs |

**Consistency scoring fallback**: for providers without logprobs, generate 3 responses at temperature 0.3-0.7 for the same prompt. The confidence score is the agreement ratio — how similar are the outputs? Measured by exact match on tool call arguments (for structured output) or text similarity (for free-form). This is slower (3x calls per model) but works for any provider.

In ensemble mode, models without logprobs can still participate — they just use the consistency fallback. Their scores are on the same 0-1 scale and are directly comparable with logprob-derived scores.

### Tools

```typescript
const tools: ToolDef[] = [
  {
    name: "read_file",
    description: "Read the contents of a file",
    parameters: { path: "string" }
  },
  {
    name: "write_file",
    description: "Write content to a file (creates or overwrites)",
    parameters: { path: "string", content: "string" }
  },
  {
    name: "edit_file",
    description: "Apply a search-and-replace edit to a file",
    parameters: { path: "string", old_content: "string", new_content: "string" }
  },
  {
    name: "run_command",
    description: "Run a shell command and return its output",
    parameters: { command: "string" }
  },
  {
    name: "list_files",
    description: "List files in a directory",
    parameters: { path: "string", recursive: "boolean" }
  }
];
```

### Agentic Loop

```
User prompt
  │
  ▼
┌─────────────── Single mode? ──────────────┐
│ Yes                                   No   │
│  │                                     │   │
│  ▼                                     ▼   │
│ Send to 1 model              Send to N models in parallel
│  │                                     │   │
│  ▼                                     ▼   │
│ Score response               Score all responses
│                                        │   │
│                                        ▼   │
│                               Match tool calls across models
│                                        │   │
│                                        ▼   │
│                               Auto-select best per slot
│                                        │   │
└──────────────────┬─────────────────────┘   │
                   │                          │
                   ▼
Display results with confidence annotations
                   │
                   ▼
User chooses: apply / retry / compare / swap / inspect / quit
                   │
  ├─ apply → execute selected tool calls, run verification
  │          loop if model wants more tool calls
  ├─ retry → re-prompt flagged tool calls (one model or all)
  ├─ compare → show side-by-side outputs for a slot
  ├─ swap → override auto-selection for a slot
  ├─ inspect → show detail for a tool call (logprob histogram)
  └─ quit → exit
```

### Shared Context in Multi-Turn Ensemble

An important subtlety: in multi-turn agentic loops, models need to see the results of previous tool calls (e.g., file contents from `read_file`). In ensemble mode:

- **Read operations** (read_file, list_files, run_command for info) are executed once and the results are shared with all models.
- **Write operations** are *not* executed until the user approves. Each model sees a "virtual" state where its own proposed writes are applied — but it doesn't see other models' writes.
- After the user selects the best outputs and applies them, the next turn starts with the actual applied state for all models.

This keeps models independent within a turn while maintaining a shared ground truth across turns.

---

## Configuration

```jsonc
// ~/.config/conf-agent/config.json
{
  // Models — first is primary (used in single mode), rest join in ensemble mode
  "models": [
    { "provider": "openai", "model": "gpt-4.1" },
    { "provider": "google", "model": "gemini-2.5-pro" },
    { "provider": "together", "model": "deepseek-v3" }
  ],

  // API keys (or use env vars: OPENAI_API_KEY, GOOGLE_API_KEY, TOGETHER_API_KEY)
  "keys": {
    "openai": null,
    "google": null,
    "together": null
  },

  // Ensemble settings
  "ensemble": {
    "enabled": false,             // Default mode (override with --ensemble flag)
    "selectionMargin": 0.10,      // Below this margin → ask user
    "maxModels": 3                // Cap parallel models
  },

  // Scoring
  "scoring": {
    "aggregation": "mean",        // "mean" | "min" | "p10"
    "flagThreshold": 0.60,        // Below this → ⚠️
    "showScores": true
  },

  // Verification
  "verification": {
    "autoRun": true,
    "testCommand": null,          // Auto-detect or override
    "lintCommand": null
  },

  // Retry
  "retry": {
    "maxRetries": 2,
    "autoRetry": false
  }
}
```

---

## Milestones

### M1: Single Model + Scoring (1 week)

- OpenAI provider with logprob extraction
- Token-to-tool-call attribution
- Aggregation at response / tool call / file level
- CLI that prints results with confidence scores
- **Deliverable**: `conf-agent "prompt"` → scored output in single mode

### M2: Interactive Loop (1 week)

- Apply / retry / inspect / quit flow
- Targeted retry of low-confidence tool calls
- Inspect view with logprob histogram
- Multi-turn agentic loop
- **Deliverable**: Full interactive single-model agent

### M3: Ensemble — Parallel Execution + Selection (1 week)

- Add Google and Together providers
- Ensemble runner (parallel execution)
- Tool call matcher (match by path/intent across models)
- Auto-selector (pick best per slot by confidence)
- Ensemble display with per-model scores
- **Deliverable**: `conf-agent --ensemble "prompt"` → multi-model scored output

### M4: Ensemble — Interactive (1 week)

- Compare view (side-by-side model outputs per slot)
- Swap pick (user overrides auto-selection)
- Retry in ensemble mode (retry one model or all)
- Handle unmatched tool calls (unique to one model)
- Shared context for multi-turn ensemble (shared reads, independent writes)
- **Deliverable**: Full interactive ensemble agent

### M5: Verification + Polish (1 week)

- Auto-detect project language and tooling
- Run lint + tests after apply
- Feed failures back for self-correction
- Consistency scoring fallback for providers without logprobs
- Config file support
- **Deliverable**: Production-ready MVP

---

## Tech Stack

- **Language**: TypeScript
- **Terminal UI**: Ink or prompts + chalk
- **LLM Providers**: OpenAI (gpt-4.1), Google (gemini-2.5-pro), Together (deepseek-v3)
- **Distribution**: npm (`npx conf-agent`)

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Logprob confidence at tool-call level is too coarse to discriminate | Core scoring thesis is weak | Validate in M1: generate correct + buggy code, check if scores differ. Fall back to consistency scoring if logprobs don't discriminate |
| Models produce very different tool call sequences, making matching hard | Ensemble selection breaks down | Start with strict matching (same path = same slot). Unmatched calls go to user review. Improve matching heuristics based on real usage in M4 |
| Ensemble mode is too slow for interactive use | Users won't use it | Measure in M3. If >10s, add streaming display so users see scores arriving incrementally. Consider background ensemble while user reviews first model's output |
| Ensemble mode is too expensive (3x token cost) | Users won't pay for it | Support cheap diversity models (deepseek-v3 via Together is ~$0.50/M tokens). The ensemble doesn't need 3 frontier models — 1 frontier + 2 cheap diverse models may be optimal |
| Provider logprob formats differ, making cross-model scores incomparable | Selection picks wrong model | Normalize all scores to same 0-1 scale. Validate cross-model calibration in M3 by running same prompts across providers |
| Tool call matching by path misses cases where models use different file paths for the same intent | Misaligned slots | In M4, add a fuzzy matching layer: if two models both write_file to paths with similar basenames, flag them as potential matches for user confirmation |

---

## Success Metrics

- **Ensemble win rate**: In ensemble mode, the selected output (best per-slot) should be correct more often than any single model alone. Measure on a curated set of 50 coding tasks.
- **Confidence discrimination**: Mean confidence for correct code should be statistically higher than for buggy code (p < 0.05).
- **Selection accuracy**: Auto-selected outputs should match what a human reviewer would pick >70% of the time.
- **Latency**: Ensemble mode should add <3s over single mode for typical tasks (parallel execution should make it close to the slowest model, not sum of all).
- **Cost efficiency**: Demonstrate that 1 frontier + 2 cheap models achieves >80% of the benefit of 3 frontier models.
