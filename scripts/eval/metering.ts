import { wrapLanguageModel, type LanguageModel } from "ai";
import type { ModelHandle } from "@/server/ai/models";

/**
 * Wraps a model with AI SDK middleware that records, per call: latency,
 * token usage (input, cached input, output incl. reasoning), whether the call
 * requested structured output, and whether it failed. Measurement only — the
 * call itself is unchanged.
 */
export interface CallRecord {
  purpose: string;
  structured: boolean;
  latencyMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  error: string | null;
}

export function meterModel(handle: ModelHandle, purpose: () => string) {
  const calls: CallRecord[] = [];
  const model = wrapLanguageModel({
    model: handle.model as Exclude<LanguageModel, string>,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate, params }) => {
        const started = performance.now();
        const structured = params.responseFormat?.type === "json";
        try {
          const result = await doGenerate();
          calls.push({
            purpose: purpose(),
            structured,
            latencyMs: Math.round(performance.now() - started),
            inputTokens: result.usage.inputTokens.total ?? 0,
            cachedInputTokens: result.usage.inputTokens.cacheRead ?? 0,
            outputTokens: result.usage.outputTokens.total ?? 0,
            error: null,
          });
          return result;
        } catch (err) {
          calls.push({
            purpose: purpose(),
            structured,
            latencyMs: Math.round(performance.now() - started),
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            error: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
          throw err;
        }
      },
    },
  });
  return { handle: { ...handle, model } satisfies ModelHandle, calls };
}
