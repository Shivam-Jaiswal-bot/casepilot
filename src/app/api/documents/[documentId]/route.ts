import { requireApiUser } from "@/server/auth/session";
import { deleteDocument, getDocument } from "@/server/documents/document-service";
import { enforceRateLimit, RATE_LIMITS } from "@/server/http/rate-limit";
import { assertSameOrigin, handle, uuidParam } from "@/server/http/respond";

export const GET = handle("documents.get", async (request: Request, ctx: RouteContext<"/api/documents/[documentId]">) => {
  const user = await requireApiUser(request);
  const documentId = uuidParam.parse((await ctx.params).documentId);
  const { storageKey: _storageKey, sha256: _sha256, ...doc } = await getDocument(user.id, documentId);
  return Response.json({ document: doc });
});

export const DELETE = handle("documents.delete", async (request: Request, ctx: RouteContext<"/api/documents/[documentId]">) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request);
  enforceRateLimit(RATE_LIMITS.mutation, user.id);
  const documentId = uuidParam.parse((await ctx.params).documentId);
  await deleteDocument(user.id, documentId);
  return new Response(null, { status: 204 });
});
