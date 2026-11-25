import { requireApiUser } from "@/server/auth/session";
import { getDocumentFile } from "@/server/documents/document-service";
import { handle, uuidParam } from "@/server/http/respond";

/** Streams the original file to its owner. PDFs render inline (viewer); DOCX downloads. */
export const GET = handle("documents.file", async (request: Request, ctx: RouteContext<"/api/documents/[documentId]/file">) => {
  const user = await requireApiUser(request);
  const documentId = uuidParam.parse((await ctx.params).documentId);
  const { doc, data } = await getDocumentFile(user.id, documentId);

  const disposition = doc.fileType === "pdf" ? "inline" : "attachment";
  const asciiName = doc.originalFilename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.originalFilename)}`,
      // Contracts are sensitive: never cache in shared caches.
      "Cache-Control": "private, no-store",
      // Content-Type comes from our own byte sniffing (never the client), and
      // nosniff stops browsers from reinterpreting it. A CSP `sandbox` is
      // deliberately not set: Chrome refuses to render PDFs in sandboxed frames.
      "X-Content-Type-Options": "nosniff",
    },
  });
});
