import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/errors";
import { resetRateLimits } from "@/server/http/rate-limit";
import { createUser, resetDatabase } from "../support/db";
import { buildPdf, SAMPLE_CONTRACT_PAGES } from "../support/fixtures";

/**
 * Route-handler tests: real handlers, real database; only the session lookup
 * is replaced so tests can act as different users (or as nobody).
 */
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/server/auth/session", () => ({
  requireApiUser: async () => {
    if (!session.userId) throw new AppError("UNAUTHORIZED", "You must be signed in.");
    return { id: session.userId, name: "Test", email: "t@example.test" };
  },
}));

const documentsRoute = await import("@/app/api/documents/route");
const documentRoute = await import("@/app/api/documents/[documentId]/route");
const fileRoute = await import("@/app/api/documents/[documentId]/file/route");
const chatRoute = await import("@/app/api/chat/route");
const analysesRoute = await import("@/app/api/documents/[documentId]/analyses/route");
const { drainQueue } = await import("@/server/jobs/worker");

const BASE = "http://localhost:3000";
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function upload(data: Buffer, filename: string, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], filename));
  return documentsRoute.POST(new Request(`${BASE}/api/documents`, { method: "POST", body: form, headers }));
}

describe("API routes", () => {
  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits();
    session.userId = await createUser("api-user");
  });

  it("requires authentication", async () => {
    session.userId = null;
    const res = await documentsRoute.GET(new Request(`${BASE}/api/documents`));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "You must be signed in." } });
  });

  it("uploads a PDF and lists it", async () => {
    const res = await upload(await buildPdf(SAMPLE_CONTRACT_PAGES), "Acme MSA.pdf");
    expect(res.status).toBe(201);
    const { document } = await res.json();
    expect(document).toMatchObject({ title: "Acme MSA", fileType: "pdf", status: "UPLOADED" });
    expect(document).not.toHaveProperty("storageKey");

    const list = await (await documentsRoute.GET(new Request(`${BASE}/api/documents?q=acme`))).json();
    expect(list.documents).toHaveLength(1);
    const none = await (await documentsRoute.GET(new Request(`${BASE}/api/documents?status=FAILED`))).json();
    expect(none.documents).toHaveLength(0);
  });

  it("rejects disguised and missing files with clear errors", async () => {
    const disguised = await upload(Buffer.from("<script>alert(1)</script>"), "contract.pdf");
    expect(disguised.status).toBe(415);
    const empty = await documentsRoute.POST(new Request(`${BASE}/api/documents`, { method: "POST", body: new FormData() }));
    expect(empty.status).toBe(400);
    const badFilter = await documentsRoute.GET(new Request(`${BASE}/api/documents?status=NOPE`));
    expect(badFilter.status).toBe(400);
  });

  it("blocks cross-origin state-changing requests", async () => {
    const res = await upload(await buildPdf(SAMPLE_CONTRACT_PAGES), "a.pdf", { origin: "https://evil.example", host: "localhost:3000" });
    expect(res.status).toBe(403);
  });

  it("hides other tenants' documents (404, not 403) and serves files privately", async () => {
    const { document } = await (await upload(await buildPdf(SAMPLE_CONTRACT_PAGES), "a.pdf")).json();
    const file = await fileRoute.GET(new Request(`${BASE}/api/documents/${document.id}/file`), params({ documentId: document.id }));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("cache-control")).toBe("private, no-store");

    session.userId = await createUser("someone-else");
    const get = await documentRoute.GET(new Request(`${BASE}/api/documents/${document.id}`), params({ documentId: document.id }));
    expect(get.status).toBe(404);
    const del = await documentRoute.DELETE(new Request(`${BASE}/api/documents/${document.id}`, { method: "DELETE" }), params({ documentId: document.id }));
    expect(del.status).toBe(404);
    const stolenFile = await fileRoute.GET(new Request(`${BASE}/api/documents/${document.id}/file`), params({ documentId: document.id }));
    expect(stolenFile.status).toBe(404);
    const badId = await documentRoute.GET(new Request(`${BASE}/api/documents/not-a-uuid`), params({ documentId: "not-a-uuid" }));
    expect(badId.status).toBe(400);
  });

  it("validates chat requests and reports unconfigured AI honestly", async () => {
    const { document } = await (await upload(await buildPdf(SAMPLE_CONTRACT_PAGES), "a.pdf")).json();
    const post = (body: unknown) =>
      chatRoute.POST(new Request(`${BASE}/api/chat`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

    expect((await post({ documentId: document.id, text: "" })).status).toBe(400);
    expect((await post({ documentId: document.id, text: "x".repeat(2001) })).status).toBe(400);
    // Document still processing → conflict rather than a half-indexed answer.
    expect((await post({ documentId: document.id, text: "termination?" })).status).toBe(409);

    await drainQueue();
    const unconfigured = await post({ documentId: document.id, text: "termination?" });
    expect(unconfigured.status).toBe(503);
    expect((await unconfigured.json()).error.message).toMatch(/DEEPSEEK_API_KEY is missing/);
  });

  it("rate-limits risk analysis starts", async () => {
    const { setModelOverride } = await import("@/server/ai/models");
    const { scriptedModel } = await import("../support/mock-llm");
    setModelOverride({ primary: scriptedModel(() => "{}").handle }); // a configured model is required to start
    const { document } = await (await upload(await buildPdf(SAMPLE_CONTRACT_PAGES), "a.pdf")).json();
    await drainQueue();
    const start = () =>
      analysesRoute.POST(new Request(`${BASE}/api/documents/${document.id}/analyses`, { method: "POST", body: "{}" }), params({ documentId: document.id }));
    const first = await start();
    expect(first.status).toBe(202);
    expect((await start()).status).toBe(409); // already running
    for (let i = 0; i < 3; i++) await start();
    const limited = await start();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    setModelOverride({});
  });

  it("refuses to queue a risk analysis when no LLM is configured", async () => {
    const { document } = await (await upload(await buildPdf(SAMPLE_CONTRACT_PAGES), "a.pdf")).json();
    await drainQueue();
    const res = await analysesRoute.POST(
      new Request(`${BASE}/api/documents/${document.id}/analyses`, { method: "POST", body: "{}" }),
      params({ documentId: document.id }),
    );
    expect(res.status).toBe(503);
  });
});
