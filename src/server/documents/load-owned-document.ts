import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";
import { getDocument, type DocumentRecord } from "./document-service";

/** Page helper: loads a document or renders the 404 page (also for other tenants' ids). */
export async function loadOwnedDocument(userId: string, documentId: string): Promise<DocumentRecord> {
  try {
    return await getDocument(userId, documentId);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}
