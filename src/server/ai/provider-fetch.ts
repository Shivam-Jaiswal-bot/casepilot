/**
 * Test hook shared by the model registry and the embedder: routes provider
 * HTTP calls through a custom fetch. Offline contract tests use it to inspect
 * the exact requests sent to OpenAI/DeepSeek and replay realistic responses,
 * without network access or API spend. Undefined in production (global fetch).
 */
let providerFetch: typeof fetch | undefined;

export function setProviderFetch(fn: typeof fetch | undefined): void {
  providerFetch = fn;
}

export function getProviderFetch(): typeof fetch | undefined {
  return providerFetch;
}
