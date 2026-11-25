import { z } from "zod";
import { DOCUMENT_STATUSES } from "@/lib/domain";
import { requireApiUser } from "@/server/auth/session";
import { getEnv } from "@/server/config/env";
import { listDocuments, uploadDocument } from "@/server/documents/document-service";
import { AppError } from "@/server/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/server/http/rate-limit";
import { assertSameOrigin, handle } from "@/server/http/respond";

const listQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.enum([...DOCUMENT_STATUSES, "ACTIVE"]).optional(),
});

export const GET = handle("documents.list", async (request: Request) => {
  const user = await requireApiUser(request);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filter = listQuery.parse(params);
  const docs = await listDocuments(user.id, { query: filter.q, status: filter.status });
  return Response.json({ documents: docs });
});

/** Multipart upload of a single file (`file` field). The client uploads several files as separate requests. */
export const POST = handle("documents.upload", async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireApiUser(request);
  enforceRateLimit(RATE_LIMITS.upload, user.id);

  const maxBytes = getEnv().MAX_UPLOAD_MB * 1024 * 1024;
  // Reject obviously oversized bodies before buffering them (multipart overhead allowance: 1 MB).
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes + 1024 * 1024) {
    throw new AppError("PAYLOAD_TOO_LARGE", `The file exceeds the ${getEnv().MAX_UPLOAD_MB} MB upload limit.`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError("BAD_REQUEST", "Expected a multipart/form-data upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("BAD_REQUEST", "No file was provided (expected field “file”).");
  if (file.size > maxBytes) {
    throw new AppError("PAYLOAD_TOO_LARGE", `The file exceeds the ${getEnv().MAX_UPLOAD_MB} MB upload limit.`);
  }

  const data = Buffer.from(await file.arrayBuffer());
  const document = await uploadDocument(user.id, { filename: file.name, declaredMimeType: file.type, data });
  return Response.json({ document }, { status: 201 });
});
