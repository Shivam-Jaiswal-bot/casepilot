/**
 * Fake OpenAI-style Responses API (also used for DeepSeek's Responses API) for
 * offline provider contract tests. It captures each HTTP request exactly as the
 * real AI SDK provider sends it, and replies in the provider's wire format —
 * JSON for generateText, server-sent events for streamText — so the REAL
 * provider parsing code runs end to end without network access or API spend.
 */

export interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

/** Decides the reply text from the flattened prompt (and the structured-output flag). */
export type Responder = (promptText: string, request: { structured: boolean; schemaName: string | null }) => string;

/** Flattens Responses API `input` (+ `instructions`) into plain text for responders. */
export function flattenInput(body: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof body.instructions === "string") parts.push(`[system] ${body.instructions}`);
  for (const item of (body.input as { role?: string; content?: unknown }[] | undefined) ?? []) {
    const content = item.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((c: { text?: string }) => c.text ?? "").join("")
          : "";
    parts.push(`[${item.role ?? "unknown"}] ${text}`);
  }
  return parts.join("\n");
}

const usage = {
  input_tokens: 1200,
  input_tokens_details: { cached_tokens: 0 },
  output_tokens: 300,
  output_tokens_details: { reasoning_tokens: 120 },
  total_tokens: 1500,
};

function sse(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

export function createFakeResponsesApi(responder: Responder, model = "fake-model") {
  const requests: CapturedRequest[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    requests.push({ url, body });

    if (!url.endsWith("/responses")) {
      return new Response(JSON.stringify({ error: { message: `unexpected endpoint ${url}`, type: "invalid_request_error", code: "404" } }), { status: 404 });
    }
    const format = (body.text as { format?: { type?: string; name?: string } } | undefined)?.format;
    const structured = format?.type === "json_schema";
    const text = responder(flattenInput(body), { structured, schemaName: format?.name ?? null });

    if (body.stream === true) {
      const events = [
        { type: "response.created", sequence_number: 0, response: { id: "resp_test", created_at: 1764000000, model } },
        {
          type: "response.output_item.added",
          sequence_number: 1,
          output_index: 0,
          item: { type: "message", id: "msg_test", role: "assistant", status: "in_progress", content: [] },
        },
        ...text.split(/(?<= )/).map((delta, i) => ({
          type: "response.output_text.delta",
          sequence_number: 2 + i,
          item_id: "msg_test",
          output_index: 0,
          content_index: 0,
          delta,
        })),
        {
          type: "response.output_item.done",
          sequence_number: 9000,
          output_index: 0,
          item: { type: "message", id: "msg_test", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
        },
        { type: "response.completed", sequence_number: 9001, response: { incomplete_details: null, usage } },
      ];
      return new Response(sse(events), { status: 200, headers: { "content-type": "text/event-stream" } });
    }

    return Response.json({
      id: "resp_test",
      object: "response",
      created_at: 1764000000,
      model,
      status: "completed",
      incomplete_details: null,
      output: [
        {
          type: "message",
          id: "msg_test",
          role: "assistant",
          status: "completed",
          phase: "final_answer",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
      usage,
    });
  };

  return { fetch: fetchImpl, requests };
}

/** Collects every JSON-schema object node that violates OpenAI strict-mode rules. */
export function strictSchemaViolations(schema: unknown, path = "$"): string[] {
  const out: string[] = [];
  if (!schema || typeof schema !== "object") return out;
  const node = schema as Record<string, unknown>;
  if (node.type === "object" || node.properties) {
    const props = Object.keys((node.properties as Record<string, unknown>) ?? {});
    const required = new Set((node.required as string[]) ?? []);
    if (node.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    for (const p of props) if (!required.has(p)) out.push(`${path}.${p}: optional property (strict mode requires all properties)`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) value.forEach((v, i) => out.push(...strictSchemaViolations(v, `${path}.${key}[${i}]`)));
      else out.push(...strictSchemaViolations(value, `${path}.${key}`));
    }
  }
  return out;
}
