// Unit tests never touch the network or a real database; provide a minimal valid config.
process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:1/unused";
process.env.BETTER_AUTH_SECRET ??= "unit-test-secret-unit-test-secret-0000";
process.env.EMBEDDING_PROVIDER = "local-hash";
