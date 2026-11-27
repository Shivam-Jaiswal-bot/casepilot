import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import type { JSONValue, LanguageModel } from "ai";
import { getEnv, type Env } from "@/server/config/env";
import { AppError } from "@/server/errors";
import { getProviderFetch } from "./provider-fetch";

export { setProviderFetch } from "./provider-fetch";

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
  // OpenAI Responses API. The LLM is separate from the embedding model (text-embedding-3-small).
  openai: { primary: "gpt-6-luna", utility: "gpt-6-luna" },
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

/** OpenAI reasoning models (gpt-6-luna) accept none | low | medium | high | xhigh | max directly. */
function openAiEffort(effort: Env["LLM_EFFORT"]): NonNullable<OpenAILanguageModelResponsesOptions["reasoningEffort"]> {
  return effort;
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
  return buildModelHandle({
    provider: env.LLM_PROVIDER,
    modelId: resolveModelId(env, role),
    apiKey,
    // Utility calls (query rewriting) are light; always run them at the lowest effort.
    effort: role === "utility" ? "low" : env.LLM_EFFORT,
    maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
  });
}

export interface ModelSpec {
  provider: LlmProvider;
  modelId: string;
  apiKey: string;
  effort: Env["LLM_EFFORT"];
  maxOutputTokens: number;
}

/** API key env var for a provider (used by the evaluation harness to build a fixed judge model). */
export function apiKeyVarFor(provider: LlmProvider): string {
  return API_KEY_VAR[provider];
}

/** Builds a model handle for an explicit provider/model (getModel uses the configured one). */
export function buildModelHandle(spec: ModelSpec): ModelHandle {
  const { provider, modelId, apiKey, effort, maxOutputTokens } = spec;
  switch (provider) {
    case "deepseek": {
      const deepseek = createDeepSeek({ apiKey, fetch: getProviderFetch() });
      return {
        // The Responses API supports JSON-schema structured outputs, which the risk engine relies on.
        // Note: DeepSeek sends the schema non-strict; outputs are validated client-side by Zod.
        model: deepseek.responses(modelId),
        label: `deepseek:${modelId}`,
        providerOptions: { deepseek: { reasoningEffort: deepSeekEffort(effort) } },
        maxOutputTokens,
      };
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey, fetch: getProviderFetch() });
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
        maxOutputTokens,
      };
    }
    case "openai": {
      const openai = createOpenAI({ apiKey, fetch: getProviderFetch() });
      const options: OpenAILanguageModelResponsesOptions = {
        reasoningEffort: openAiEffort(effort),
        // Contracts are confidential: don't retain responses on OpenAI's side.
        // (We never rely on server-side conversation state; history is ours.)
        store: false,
        // Reasoning summaries are never shown to users; omitting them saves output tokens.
        reasoningSummary: null,
      };
      return {
        // `openai(id)` uses the Responses API: strict JSON-schema structured outputs by default.
        model: openai(modelId),
        label: `openai:${modelId}`,
        providerOptions: { openai: options as Record<string, JSONValue> },
        maxOutputTokens,
      };
    }
  }
}
