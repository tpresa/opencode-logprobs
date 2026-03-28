import Together from "together-ai";
import type {
  Provider,
  GenerationResult,
  Message,
  ToolDef,
  TokenLogprob,
  ToolCallResult,
} from "./types.js";

export class TogetherProvider implements Provider {
  readonly id = "together";
  readonly supportsLogprobs = true;

  private client: Together;
  private model: string;

  constructor(apiKey: string, model = "deepseek-ai/DeepSeek-V3") {
    this.client = new Together({ apiKey });
    this.model = model;
  }

  async generate(messages: Message[], tools: ToolDef[]): Promise<GenerationResult> {
    const start = Date.now();

    // Together uses an OpenAI-compatible API
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map(toTogetherMessage),
      tools: tools.map(toTogetherTool),
      logprobs: 1,
    });

    const latencyMs = Date.now() - start;
    const choice = response.choices[0];

    const tokens = extractTokenLogprobs(choice);
    const toolCalls = extractToolCalls(choice);

    return {
      content: (choice.message as { content?: string }).content ?? "",
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

function toTogetherMessage(msg: Message) {
  return {
    role: msg.role as "system" | "user" | "assistant",
    content: msg.content,
  };
}

function toTogetherTool(tool: ToolDef) {
  return {
    type: "function" as const,
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

function extractTokenLogprobs(_choice: unknown): TokenLogprob[] {
  // TODO: extract from Together's logprobs response format
  return [];
}

function extractToolCalls(_choice: unknown): ToolCallResult[] {
  // TODO: extract tool calls from Together's OpenAI-compatible response
  return [];
}
