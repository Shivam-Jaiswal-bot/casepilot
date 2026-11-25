import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getEnv } from "@/server/config/env";
import { getDb, schema } from "@/server/db/client";

function createAuth() {
  const env = getEnv();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh daily
    },
    // Brute-force protection on sign-in / sign-up endpoints (in-memory; per instance).
    rateLimit: { enabled: true, window: 60, max: 30 },
    telemetry: { enabled: false },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __casepilotAuth?: Auth };

/** Lazily constructed so builds and tests don't require auth configuration. */
export function getAuth(): Auth {
  globalForAuth.__casepilotAuth ??= createAuth();
  return globalForAuth.__casepilotAuth;
}
