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
  // TODO: map token ranges once we correlate logprobs to tool call boundaries
  return toolCalls.map((tc, i) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
    tokenRange: [0, 0] as [number, number], // placeholder — needs logprob correlation
  }));
}
