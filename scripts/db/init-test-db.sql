-- Runs once when the Postgres volume is first created.
-- A separate database keeps integration tests from touching development data.
CREATE DATABASE casepilot_test OWNER casepilot;
\connect casepilot
CREATE EXTENSION IF NOT EXISTS vector;
\connect casepilot_test
CREATE EXTENSION IF NOT EXISTS vector;
