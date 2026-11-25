import { z } from "zod";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logging/logger";

/** JSON error envelope used by every API route: `{ error: { code, message, details? } }`. */
export function errorResponse(err: unknown, context: string): Response {
  if (err instanceof AppError) {
    const headers: Record<string, string> = {};
    const retry = err.details?.retryAfterSeconds;
    if (typeof retry === "number") headers["Retry-After"] = String(retry);
    if (err.status >= 500) logger.error(`${context}.failed`, { code: err.code, error: err });
    return Response.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status, headers });
  }
  if (err instanceof z.ZodError) {
    return Response.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "The request is invalid.",
          details: { issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
        },
      },
      { status: 400 },
    );
  }
  // Unknown errors: log internally, return a generic message (no internals leak to clients).
  logger.error(`${context}.unhandled`, { error: err });
  return Response.json({ error: { code: "INTERNAL", message: "An unexpected error occurred." } }, { status: 500 });
}

/** Wraps a route handler so every thrown error becomes a safe JSON response. */
export function handle<A extends unknown[]>(context: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err, context);
    }
  };
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON.");
  }
  return schema.parse(body);
}

export const uuidParam = z.string().uuid();

/**
 * CSRF defence in depth for state-changing requests. Session cookies are
 * SameSite=Lax already; additionally require the Origin header (sent by all
 * modern browsers on POST/DELETE) to match this server.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, tests) don't send Origin and don't carry ambient cookies
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Invalid request origin.");
  }
  if (!host || originHost !== host) throw new AppError("FORBIDDEN", "Cross-origin requests are not allowed.");
}
