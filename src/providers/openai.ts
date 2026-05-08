import OpenAI from "openai";
import type {
  Provider,
  GenerationResult,
  Message,
  ToolDef,
  TokenLogprob,
  ToolCallResult,
} from "./types.js";

export class OpenAIProvider implements Provider {
  readonly id = "openai";
  readonly supportsLogprobs = true;

  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-4.1") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generate(messages: Message[], tools: ToolDef[]): Promise<GenerationResult> {
    const start = Date.now();

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map(toOpenAIMessage),
      tools: tools.map(toOpenAITool),
      logprobs: true,
      top_logprobs: 1,
    });

    const latencyMs = Date.now() - start;
    const choice = response.choices[0];

    const tokens = extractTokenLogprobs(choice.logprobs);
    const toolCalls = extractToolCalls(choice.message.tool_calls ?? []);

    return {
      content: choice.message.content ?? "",
      tokens,
      toolCalls,
      model: this.model,
      provider: this.id,
      usage: {
        input: response.usage?.prompt_tokens ?? 0,
        output: response.usage?.completion_tokens ?? 0,
      },
      latencyMs,
    };
  }
}

// ── Helpers ──

function toOpenAIMessage(msg: Message): OpenAI.Chat.ChatCompletionMessageParam {
  if (msg.role === "tool") {
    return {
      role: "tool",
      content: msg.content,
      tool_call_id: msg.toolCallId!,
    };
  }
  return { role: msg.role as "system" | "user" | "assistant", content: msg.content };
}

function toOpenAITool(tool: ToolDef): OpenAI.Chat.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters,
      },
    },
  };
}

function extractTokenLogprobs(
  logprobs: OpenAI.Chat.Completions.ChatCompletion.Choice["logprobs"]
): TokenLogprob[] {
  if (!logprobs?.content) return [];

  return logprobs.content.map((entry, i) => ({
    token: entry.token,
    logprob: entry.logprob,
    offset: i,
  }));
}

function extractToolCalls(
  toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[]
): ToolCallResult[] {
  // tokenRange is null because OpenAI Chat Completions does not return logprobs for
  // tool-call argument tokens: when finish_reason === "tool_calls", choice.logprobs.content
  // is null (and sometimes the whole `logprobs` object is null). Verified empirically in
  // OpenAI Community thread #579561 and instructor#1223. The documented unblock is to
  // switch the request from `tools` to Structured Outputs (`response_format: json_schema`),
  // where logprobs.content IS populated for the JSON tokens — deferred to a follow-up.
  const results: ToolCallResult[] = [];
  for (const tc of toolCalls) {
    const args = parseArguments(tc.function.arguments, tc.id);
    if (args === null) continue;
    results.push({
      id: tc.id,
      name: tc.function.name,
      arguments: args,
      tokenRange: null,
    });
  }
  return results;
}

function parseArguments(raw: string, toolCallId: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`OpenAI provider: tool call ${toolCallId} arguments are not a JSON object — skipping.`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`OpenAI provider: failed to parse arguments for tool call ${toolCallId}: ${message}`);
    return null;
  }
}
