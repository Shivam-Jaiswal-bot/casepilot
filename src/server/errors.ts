/**
 * Application error hierarchy.
 *
 * `message` on an AppError is always safe to show to the end user. Internal
 * details (stack traces, SQL errors, provider responses) stay in logs.
 */
export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED"
  | "INTERNAL";

const STATUS: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  NOT_CONFIGURED: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);

/**
 * Error raised inside the document/analysis pipeline.
 * `retryable` distinguishes transient faults (network, rate limits) from
 * permanent ones (corrupt file, no extractable text) so the job queue does not
 * waste attempts on inputs that will never succeed.
 */
export class PipelineError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(code: string, userMessage: string, options: { retryable: boolean; cause?: unknown }) {
    super(userMessage, { cause: options.cause });
    this.name = "PipelineError";
    this.code = code;
    this.retryable = options.retryable;
    this.userMessage = userMessage;
  }
}

/** Best-effort classification of unknown errors (e.g. provider/network failures). */
export function toPipelineError(err: unknown): PipelineError {
  if (err instanceof PipelineError) return err;
  if (err instanceof AppError && err.code === "NOT_CONFIGURED") {
    return new PipelineError("NOT_CONFIGURED", err.message, { retryable: false, cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  const transient = /timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|rate.?limit|429|5\d\d|overloaded|fetch failed/i.test(
    message,
  );
  return new PipelineError(
    transient ? "TRANSIENT" : "UNEXPECTED",
    transient
      ? "A temporary error occurred while processing. It will be retried automatically."
      : "An unexpected error occurred while processing this item.",
    { retryable: transient, cause: err },
  );
}
