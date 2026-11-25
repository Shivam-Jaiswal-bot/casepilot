import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

/** Wipes all application data. Only ever runs against the *_test database (enforced in setup). */
export async function resetDatabase(): Promise<void> {
  await getDb().execute(sql`
    truncate table messages, conversations, risk_findings, processing_jobs, risk_analyses,
      document_chunks, document_segments, documents, session, account, verification, "user"
    restart identity cascade
  `);
}

export async function createUser(id: string): Promise<string> {
  await getDb().insert(user).values({ id, name: `User ${id}`, email: `${id}@example.test` });
  return id;
}
