import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import type { JSONValue, LanguageModel } from "ai";
import { getEnv, type Env } from "@/server/config/env";
import { AppError } from "@/server/errors";

/**
 * Language-model registry.
 *
 * Services never construct providers themselves; they ask for a `ModelHandle`
 * which bundles the model with its provider-specific call options. Tests inject
 * a handle wrapping `MockLanguageModelV4`, so no network calls happen in CI.
 *
 * Roles:
 *  - primary: grounded answers and risk analysis (quality matters most)
 *  - utility: follow-up question rewriting (cheap, low effort)
 */
export interface ModelHandle {
  model: LanguageModel;
  /** Provider + model id, recorded on stored analyses for auditability. */
  label: string;
  providerOptions?: Record<string, Record<string, JSONValue>>;
  maxOutputTokens: number;
}

export type ModelRole = "primary" | "utility";
export type LlmProvider = Env["LLM_PROVIDER"];

/** Provider defaults, used when LLM_MODEL / LLM_UTILITY_MODEL are not set. */
export const DEFAULT_MODELS: Record<LlmProvider, { primary: string; utility: string } | null> = {
  // DeepSeek Responses API models (JSON-schema structured outputs supported).
  deepseek: { primary: "deepseek-v4-pro", utility: "deepseek-flash" },
  anthropic: { primary: "claude-opus-5-5", utility: "claude-opus-5-5" },
  // No default for OpenAI: the model must be chosen explicitly via LLM_MODEL.
  openai: null,
};

const API_KEY_VAR: Record<LlmProvider, "DEEPSEEK_API_KEY" | "ANTHROPIC_API_KEY" | "OPENAI_API_KEY"> = {
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

let override: Partial<Record<ModelRole, ModelHandle>> = {};

/** Test hook: replace the configured models. Pass `{}` to reset. */
export function setModelOverride(handles: Partial<Record<ModelRole, ModelHandle>>): void {
  override = handles;
}

export function isLlmConfigured(): boolean {
  if (override.primary) return true;
  const env = getEnv();
  return Boolean(env[API_KEY_VAR[env.LLM_PROVIDER]]);
}

export function resolveModelId(env: Env, role: ModelRole): string {
  const explicit = role === "utility" ? (env.LLM_UTILITY_MODEL ?? env.LLM_MODEL) : env.LLM_MODEL;
  // An explicitly configured primary model is also used for utility calls unless LLM_UTILITY_MODEL is set.
  if (role === "utility" && !env.LLM_UTILITY_MODEL && env.LLM_MODEL) return env.LLM_MODEL;
  if (explicit) return explicit;
  const defaults = DEFAULT_MODELS[env.LLM_PROVIDER];
  if (!defaults) {
    throw new AppError("NOT_CONFIGURED", `LLM_MODEL must be set when LLM_PROVIDER=${env.LLM_PROVIDER}.`);
  }
  return defaults[role];
}

/** Maps the provider-neutral LLM_EFFORT setting onto DeepSeek's documented reasoningEffort values. */
function deepSeekEffort(effort: Env["LLM_EFFORT"]): "low" | "high" | "max" {
  if (effort === "low") return "low";
  if (effort === "xhigh" || effort === "max") return "max";
  return "high";
}

export function getModel(role: ModelRole = "primary"): ModelHandle {
  const injected = override[role] ?? (role === "utility" ? override.primary : undefined);
  if (injected) return injected;

  const env = getEnv();
  const keyVar = API_KEY_VAR[env.LLM_PROVIDER];
  const apiKey = env[keyVar];
  if (!apiKey) {
    throw new AppError("NOT_CONFIGURED", `The AI assistant is not configured: ${keyVar} is missing.`);
  }
  const modelId = resolveModelId(env, role);
  // Utility calls (query rewriting) are light; always run them at the lowest effort.
  const effort = role === "utility" ? "low" : env.LLM_EFFORT;

  switch (env.LLM_PROVIDER) {
    case "deepseek": {
      const deepseek = createDeepSeek({ apiKey });
      return {
        // The Responses API supports JSON-schema structured outputs, which the risk engine relies on.
        model: deepseek.responses(modelId),
        label: `deepseek:${modelId}`,
        providerOptions: { deepseek: { reasoningEffort: deepSeekEffort(effort) } },
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      };
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      const options: AnthropicLanguageModelOptions = {
        effort,
        // If a safety classifier declines a turn, the API retries it server-side on
        // Anthropic's recommended fallback model instead of returning a refusal.
        fallbacks: "default",
      };
      return {
        model: anthropic(modelId),
        label: `anthropic:${modelId}`,
        providerOptions: { anthropic: options as Record<string, JSONValue> },
        maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      };
    }
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return { model: openai(modelId), label: `openai:${modelId}`, maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS };
    }
  }
}
