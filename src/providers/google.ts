import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type Tool,
} from "@google/generative-ai";
import type {
  Provider,
  GenerationResult,
  Message,
  ToolDef,
  TokenLogprob,
  ToolCallResult,
} from "./types.js";

export class GoogleProvider implements Provider {
  readonly id = "google";
  readonly supportsLogprobs = true;

  private client: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model = "gemini-2.5-pro") {
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = model;
  }

  async generate(messages: Message[], tools: ToolDef[]): Promise<GenerationResult> {
    const start = Date.now();

    const genModel = this.client.getGenerativeModel({ model: this.model });

    // TODO: implement full message/tool conversion and logprob extraction
    // Gemini API exposes logprobs via generateContent with logprobs config
    const geminiTools: Tool[] | undefined =
      tools.length > 0
        ? [{ functionDeclarations: tools.map(toGeminiTool) as FunctionDeclaration[] }]
        : undefined;

    const _result = await genModel.generateContent({
      contents: messages.map(toGeminiContent),
      tools: geminiTools,
    });

    const latencyMs = Date.now() - start;
    const response = _result.response;
    const candidate = response.candidates?.[0];

    const tokens = extractTokenLogprobs(candidate);
    const toolCalls = extractToolCalls(candidate);

    return {
      content: response.text() ?? "",
      tokens,
      toolCalls,
      model: this.model,
      provider: this.id,
      usage: {
        input: response.usageMetadata?.promptTokenCount ?? 0,
        output: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      latencyMs,
    };
  }
}

// ── Helpers ──

function toGeminiContent(msg: Message) {
  return {
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  };
}

function toGeminiTool(tool: ToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: tool.parameters,
    },
  };
}

function extractTokenLogprobs(_candidate: unknown): TokenLogprob[] {
  // TODO: extract logprobs from Gemini response once API shape is confirmed
  return [];
}

function extractToolCalls(_candidate: unknown): ToolCallResult[] {
  // TODO: extract function calls from candidate parts
  return [];
}
