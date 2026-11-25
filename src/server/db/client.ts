import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/server/config/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * A single pooled connection per process. During `next dev`, modules are
 * re-evaluated on hot reload, so the pool is cached on globalThis to avoid
 * exhausting Postgres connections.
 */
const globalForDb = globalThis as unknown as {
  __casepilotSql?: postgres.Sql;
  __casepilotDb?: Database;
};

export function getDb(): Database {
  if (!globalForDb.__casepilotDb) {
    const sql = postgres(getEnv().DATABASE_URL, {
      max: 10,
      idle_timeout: 30,
      // Enough headroom for the job worker and request handlers in one process.
      connect_timeout: 10,
      onnotice: () => {},
    });
    globalForDb.__casepilotSql = sql;
    globalForDb.__casepilotDb = drizzle(sql, { schema });
  }
  return globalForDb.__casepilotDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__casepilotSql?.end({ timeout: 5 });
  globalForDb.__casepilotSql = undefined;
  globalForDb.__casepilotDb = undefined;
}

export { schema };
