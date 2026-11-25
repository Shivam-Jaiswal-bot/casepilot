import { z } from "zod";
import { requireApiUser } from "@/server/auth/session";
import { enforceRateLimit, RATE_LIMITS } from "@/server/http/rate-limit";
import { assertSameOrigin, handle, parseJson, uuidParam } from "@/server/http/respond";
import { startRiskAnalysis } from "@/server/risk/risk-service";

const body = z.object({
  perspective: z.string().trim().max(200).nullable().optional(),
});

export const POST = handle("analyses.start", async (request: Request, ctx: RouteContext<"/api/documents/[documentId]/analyses">) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request);
  enforceRateLimit(RATE_LIMITS.analysis, user.id);
  const documentId = uuidParam.parse((await ctx.params).documentId);
  const input = await parseJson(request, body);
  const analysis = await startRiskAnalysis(user.id, documentId, input.perspective ?? null);
  return Response.json({ analysis: { id: analysis.id, status: analysis.status } }, { status: 202 });
});
