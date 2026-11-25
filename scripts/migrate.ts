/**
 * Applies Drizzle migrations from ./drizzle.
 *   npm run db:migrate         -> DATABASE_URL
 *   npm run db:migrate:test    -> TEST_DATABASE_URL
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const useTestDb = process.argv.includes("--test");
  const url = useTestDb ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) {
    throw new Error(`${useTestDb ? "TEST_DATABASE_URL" : "DATABASE_URL"} is not set`);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log(`Migrations applied (${useTestDb ? "test" : "primary"} database).`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
