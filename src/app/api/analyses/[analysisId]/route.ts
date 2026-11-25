import { requireApiUser } from "@/server/auth/session";
import { handle, uuidParam } from "@/server/http/respond";
import { getAnalysis } from "@/server/risk/risk-service";

/** Lightweight status endpoint polled by the risk page while an analysis runs. */
export const GET = handle("analyses.get", async (request: Request, ctx: RouteContext<"/api/analyses/[analysisId]">) => {
  const user = await requireApiUser(request);
  const analysisId = uuidParam.parse((await ctx.params).analysisId);
  const { analysis, findings } = await getAnalysis(user.id, analysisId);
  return Response.json({
    analysis: {
      id: analysis.id,
      status: analysis.status,
      errorMessage: analysis.errorMessage,
      severityCounts: analysis.severityCounts,
      findingCount: findings.length,
    },
  });
});
