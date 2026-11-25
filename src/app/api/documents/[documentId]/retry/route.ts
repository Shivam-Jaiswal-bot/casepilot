import { requireApiUser } from "@/server/auth/session";
import { retryDocument } from "@/server/documents/document-service";
import { enforceRateLimit, RATE_LIMITS } from "@/server/http/rate-limit";
import { assertSameOrigin, handle, uuidParam } from "@/server/http/respond";

export const POST = handle("documents.retry", async (request: Request, ctx: RouteContext<"/api/documents/[documentId]/retry">) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request);
  enforceRateLimit(RATE_LIMITS.mutation, user.id);
  const documentId = uuidParam.parse((await ctx.params).documentId);
  await retryDocument(user.id, documentId);
  return Response.json({ ok: true }, { status: 202 });
});
