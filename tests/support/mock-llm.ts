import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { ModelHandle } from "@/server/ai/models";

/**
 * Scripted mock LLM: the responder receives the full serialised prompt and
 * returns the text the "model" should produce. This lets tests assert both
 * what the model was shown (grounding, injection handling) and how the
 * application treats what it says (citation validation, evidence checks).
 */
export type Responder = (promptText: string) => string;

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

export function promptToText(prompt: unknown): string {
  // LanguageModelV4Prompt: [{ role, content: string | [{ type: "text", text }] }]
  return (prompt as { role: string; content: string | { type: string; text?: string }[] }[])
    .map((m) => `[${m.role}] ${typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join("")}`)
    .join("\n");
}

export function scriptedModel(responder: Responder): { handle: ModelHandle; model: MockLanguageModelV4; prompts: string[] } {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const text = responder(promptToText(options.prompt));
      prompts.push(promptToText(options.prompt));
      return { content: [{ type: "text", text }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] };
    },
    doStream: async (options) => {
      const text = responder(promptToText(options.prompt));
      prompts.push(promptToText(options.prompt));
      const words = text.split(/(?<= )/);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t1" },
            ...words.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
          ],
        }),
      };
    },
  });
  return { handle: { model, label: "mock:scripted", maxOutputTokens: 1024 }, model, prompts };
}
