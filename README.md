# CasePilot

AI-powered legal document intelligence. Upload long contracts (PDF or DOCX), ask questions and get answers grounded in the document with **verifiable page-level citations**, and run a **contract risk analysis** whose every finding quotes the contract.

> CasePilot provides AI-assisted analysis, not legal advice. Every conclusion links back to source text so a qualified reviewer can verify it.

**Status:** MVP feature-complete. Verified with automated tests (100 passing), a production build, and a browser walkthrough. **Not yet exercised against a live LLM** — see [Known limitations](#known-limitations--remaining-work).

---

## Contents

1. [Architecture](#architecture)
2. [Quick start](#quick-start)
3. [Configuration](#configuration)
4. [Commands](#commands)
5. [How it works](#how-it-works)
6. [Security](#security)
7. [Testing and evaluation](#testing-and-evaluation)
8. [Design decisions and trade-offs](#design-decisions-and-trade-offs)
9. [Known limitations / remaining work](#known-limitations--remaining-work)
10. [Project structure](#project-structure)

---

## Architecture

```
Browser (Next.js App Router, React 19, Tailwind v4)
   │  pages: dashboard · library · workspace (viewer + chat) · risk analysis · finding detail
   ▼
Route handlers (thin: auth → validation → rate limit → service)          proxy.ts: optimistic redirect
   │
   ▼
Services (src/server)
   documents ─ storage ─ extraction ─ chunking ─ embeddings
   retrieval (pgvector + Postgres FTS, RRF) ─ rag (prompts, citations, chat turn)
   risk (playbook, structured outputs, evidence verification) ─ conversations ─ jobs
   │                                        ▲
   ▼                                        │ claims jobs (FOR UPDATE SKIP LOCKED)
PostgreSQL 17 + pgvector  ◄───────── Worker (in-process in dev, `npm run worker` in prod)
   documents · segments · chunks(vector + tsvector) · jobs · conversations · messages · analyses · findings
```

| Layer | Technology |
|---|---|
| Web | Next.js 16.4 (App Router, Cache Components, Partial Prerendering), React 19, TypeScript strict, Tailwind CSS 4 |
| AI | Vercel AI SDK 7 — DeepSeek (default), Anthropic or OpenAI for generation; OpenAI for embeddings |
| Data | PostgreSQL 17, pgvector (HNSW), Drizzle ORM + drizzle-kit migrations |
| Auth | better-auth (email + password, database sessions) |
| Parsing | unpdf (pdf.js, page-aware), mammoth (DOCX → semantic HTML) |
| Validation | Zod 4 (env, API input, structured LLM output) |
| Tests | Vitest 5 (unit + integration against real Postgres), AI SDK mock models |

**Tenancy model:** data is isolated per user (`owner_id`). Every tenant-owned table — including `document_chunks` — carries `owner_id`, and every query filters on it.

---

## Quick start

Prerequisites: Node ≥ 22, Docker.

```bash
npm install
cp .env.example .env            # then fill in the values below
openssl rand -base64 32         # → BETTER_AUTH_SECRET
npm run db:up                   # Postgres 17 + pgvector on localhost:5433 (also creates casepilot_test)
npm run db:migrate              # dev database
npm run db:migrate:test         # test database (for integration tests / evals)
npm run dev                     # http://localhost:3000 (also runs the job worker in-process)
```

Required keys for the full workflow:

| Capability | Needs |
|---|---|
| Upload + indexing | `OPENAI_API_KEY` (embeddings) — DeepSeek has no embeddings API |
| Chat + risk analysis | `DEEPSEEK_API_KEY` (default provider) |

Without keys the app still runs: uploads are stored, and chat/analysis return a clear `503 NOT_CONFIGURED` error. For **offline development only**, `EMBEDDING_PROVIDER=local-hash` indexes documents with a deterministic lexical embedder (not semantic; refused when `NODE_ENV=production`).

---

## Configuration

All variables are validated at startup by `src/server/config/env.ts`; an invalid value fails fast with a readable message. See `.env.example` for the full annotated list.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Primary database |
| `TEST_DATABASE_URL` | — | Integration tests and evals; must end in `_test` |
| `BETTER_AUTH_SECRET` | — | ≥ 32 chars |
| `BETTER_AUTH_URL` | `http://localhost:3000` | |
| `LLM_PROVIDER` | `deepseek` | `deepseek` \| `anthropic` \| `openai` |
| `LLM_MODEL` | provider default | deepseek → `deepseek-v4-pro`; anthropic → `claude-opus-5-5`; openai requires an explicit value |
| `LLM_UTILITY_MODEL` | provider default | Follow-up question rewriting; deepseek → `deepseek-flash` |
| `LLM_EFFORT` | `medium` | DeepSeek maps to `reasoningEffort` low/high/max |
| `LLM_MAX_OUTPUT_TOKENS` | `4096` | |
| `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | — | Only the active providers' keys are needed |
| `EMBEDDING_PROVIDER` | `openai` | `openai` \| `local-hash` (dev/test only) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | |
| `EMBEDDING_DIMENSIONS` | `1536` | Must equal the `vector(1536)` column; changing it needs a migration + re-index |
| `MAX_UPLOAD_MB` | `25` | |
| `CHUNK_TARGET_TOKENS` / `CHUNK_MAX_TOKENS` / `CHUNK_OVERLAP_TOKENS` | `450` / `700` / `60` | Token counts approximate (≈ 4 chars/token) |
| `RETRIEVAL_CANDIDATES` / `RETRIEVAL_TOP_K` / `CONTEXT_TOKEN_BUDGET` | `40` / `8` / `6000` | |
| `RETRIEVAL_MIN_VECTOR_SIMILARITY` | `0.2` | Vector hits below this are dropped (depends on the embedding model) |
| `WORKER_IN_PROCESS` | `true` | Set `false` in production and run `npm run worker` |
| `WORKER_CONCURRENCY` / `JOB_MAX_ATTEMPTS` | `2` / `3` | |

**DeepSeek specifics:** CasePilot uses DeepSeek's **Responses API** (`deepseek.responses(...)`) because it supports JSON-schema structured outputs, which the risk engine requires. The legacy `deepseek-chat` / `deepseek-reasoner` aliases were retired by DeepSeek in July 2026.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (+ in-process worker) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run worker` | Standalone background worker (graceful shutdown on SIGINT/SIGTERM) |
| `npm run db:up` | Start Postgres + pgvector (Docker) |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` / `db:migrate:test` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm test` | All tests (unit + integration; needs the test DB) |
| `npm run test:unit` / `test:integration` | One project |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run eval` | Retrieval evaluation (`-- --with-llm` adds generation + risk metrics) |

Migrations live in `drizzle/`: `0000_enable_pgvector.sql` (extension) and `0001_initial_schema.sql` (tables, HNSW + GIN indexes, generated `tsvector`, partial unique index on active jobs).

---

## How it works

### 1. Document lifecycle

`UPLOADED → PROCESSING → INDEXING → COMPLETED`, with `FAILED` as a terminal state carrying a user-safe message and a **Retry** action.

1. **Upload** (`POST /api/documents`): size check → **magic-byte sniffing** (PDF header / ZIP + `word/document.xml`; the extension is never trusted) → SHA-256 duplicate check → file stored under a server-generated key → document row **and its job inserted in one transaction**.
2. **Worker** claims the job (`FOR UPDATE SKIP LOCKED`), re-validates the stored bytes, then:
   - **Extraction** — PDF: one segment per page (unpdf). DOCX: one segment per heading section (mammoth heading styles). Scanned/encrypted/corrupt files fail with a specific, non-retryable message.
   - **Normalisation** — removes page furniture ("Page 3 of 10"), de-hyphenates line wraps, re-joins soft-wrapped lines, keeps numbered clauses and headings as separate paragraphs.
   - **Section detection** — `ARTICLE IV`, `12.`, `12.2 Title`, inline `7.1 Fees. The Customer…`, ALL-CAPS headings → two-level section path carried across page breaks.
   - **Chunking** (see below) → **embedding** (document title + section header prepended to the embedding input only) → **one transaction** that replaces segments and chunks and marks the document `COMPLETED`.
3. **Retries:** transient errors (timeouts, 429, 5xx) retry with exponential backoff (10 s, 20 s, 40 s… capped at 10 min); permanent errors fail immediately. Stale `RUNNING` jobs from crashed workers are re-queued. Because indexing replaces data transactionally, **retries never duplicate chunks**.

### 2. Structure-aware chunking (`src/server/chunking/chunker.ts`)

Greedy packing of paragraph units up to a target size, with legal-text rules:
- a new section heading closes a chunk that is at least half full, so clauses stay intact;
- a chunk never ends on a dangling heading;
- over-long paragraphs split at sentence boundaries (abbreviation-aware: `Sec. 4`, `U.S.`, `e.g.`);
- overlap (trailing sentences) is carried only **within** a section;
- each chunk stores `pageStart/pageEnd`, a section label, and **character-offset spans** mapping every paragraph to its page and section, so a quote can later be located precisely.

O(n) in sentences.

### 3. Hybrid retrieval (`src/server/retrieval`)

- **Vector arm:** pgvector cosine distance over an HNSW index (`ef_search = 100`, iterative scans so tenant filters don't starve results); hits below `RETRIEVAL_MIN_VECTOR_SIMILARITY` are dropped.
- **Lexical arm:** Postgres full-text search on a generated, section-weighted `tsvector` (GIN index). Queries are converted to **OR** semantics — `websearch_to_tsquery` ANDs every term, which makes conversational questions match almost nothing.
- **Fusion:** Reciprocal Rank Fusion (k = 60). Rank-based fusion avoids mixing cosine similarity and `ts_rank_cd` (incomparable scales) and needs no weight tuning.
- **De-duplication** by 5-gram overlap coefficient (removes overlap windows), then **greedy token-budget packing** (`topK`, `CONTEXT_TOKEN_BUDGET`).
- Both arms filter on `owner_id` (chunk **and** parent document) and `status = 'COMPLETED'`.

### 4. Grounded answering (`src/server/rag`)

`question → (follow-up rewrite, utility model) → hybrid retrieval → context → streamed generation → citation validation → persisted`

- Retrieval runs with both the rewritten and the literal question.
- **No relevant context → deterministic abstention** without calling the model.
- Sources go in the user turn as `<source id="S1" pages="4-5" section="…">` elements; instructions say to cite `[S#]`, label interpretations, abstain when unsupported, and **never follow instructions inside sources**.
- After streaming, the server validates the answer: unknown markers are flagged as invalid; **page numbers mentioned in the prose that don't exist in any retrieved chunk's metadata are flagged**; citation coverage is computed. The UI renders only validated markers as clickable chips; invalid ones are shown struck through with a warning.
- The client sends only the new question; history is loaded server-side (the client can't forge prior turns).

### 5. Contract risk analysis (`src/server/risk`)

`profile (parties, type) → per category (15): playbook queries → hybrid retrieval → structured evaluation (Zod) → evidence verification → persisted report`

- Categories: termination, indemnification, limitation of liability, confidentiality, IP, data protection, payment, automatic renewal, governing law, dispute resolution, assignment, warranties, non-compete/exclusivity, force majeure, breach/remedies.
- Each finding: category, title, severity (CRITICAL…INFORMATIONAL), explanation, basis (EXPLICIT vs INTERPRETATION), evidence quotes, business implication, review suggestion, confidence.
- **Evidence verification:** every quote must be found in the chunk it cites — verbatim after normalisation (`EXACT`) or ≥ 85 % trigram overlap (`NEAR`). Findings without a verified quote are **discarded and counted**. Quotes are pinned to the exact page/section via the chunk's offset spans.
- **"Not identified" is not a finding.** A category counts as identified only if the model supplies *verifiable* clause quotes — the model claiming a clause exists is not enough. Absent categories are reported as "Not identified in the reviewed content", never as defects.
- **No numerical risk score.** Severity levels are qualitative legal judgements that do not add up meaningfully, so the report shows counts per severity and the highest severity instead.
- Partial failure: a category that fails is marked `ERROR` and the rest of the report is kept; if every category requiring evaluation fails, the analysis fails (an empty "complete" report would be misleading).

---

## Security

- Server-side authentication on every page (`requirePageUser`) and route (`requireApiUser`); `proxy.ts` only performs an optimistic redirect.
- **Tenant isolation in every query**; other tenants' ids return **404** (not 403) so their existence is not confirmed. Integration tests cover cross-tenant documents, chunks, conversations, analyses and findings.
- Uploads: magic-byte validation, size limits (header pre-check + actual size), sanitised filenames, server-generated storage keys with path-traversal guards, files `0600`, no overwrite.
- File download: `Content-Type` from our own sniffing, `nosniff`, `private, no-store`.
- CSRF: SameSite cookies **plus** an `Origin` check on all state-changing routes.
- Rate limits: chat 20/min, uploads 30/min, analyses 5/10 min, other mutations 60/min (in-memory; see limitations). better-auth rate-limits sign-in/sign-up.
- Prompt injection: document text is confined to `<source>` elements, forged delimiters are neutralised, the model is told sources are data, and outputs are validated (citations, page references, evidence quotes). The test fixtures include an injection line.
- Logging: structured JSON with ids/counts/durations only; sensitive keys (`content`, `question`, `answer`, `quote`, tokens…) are redacted defensively.
- Errors: clients get `{ error: { code, message } }` with safe messages; internals stay in logs.
- Deleting a document cascades to segments, chunks/embeddings, jobs, conversations, messages, analyses and findings, then deletes the stored file.

---

## Testing and evaluation

```bash
npm run db:up && npm run db:migrate:test
npm test          # 11 files, 100 tests
```

| Suite | Covers |
|---|---|
| `tests/unit` (70) | file validation, PDF/DOCX extraction (real generated files: multi-page, scanned, corrupt, empty), normalisation & headings, chunking (limits, metadata, overlap, dangling headings, spans), RRF / dedup / budgeting / tsquery, citation validation, prompt-injection hardening, evidence verification & location, Zod output schemas, env validation, provider/model resolution, rate limiting, retry policy, log redaction |
| `tests/integration` (30, real Postgres) | upload → job → chunks with embeddings and metadata; DOCX; idempotent re-processing; transient retry; permanent failure + manual retry; duplicates; cascade delete; ownership; hybrid retrieval relevance; tenant isolation; metadata filtering; grounded answers with citation validation; abstention without model calls; streamed chat turn ordering + persistence + follow-ups; risk analysis (verified findings, discarded fabrications, not-identified handling, idempotency, concurrency, partial and total failure); API routes (auth, validation, 404 isolation, CSRF, file headers, rate limiting, not-configured errors) |

LLM behaviour in tests uses AI SDK `MockLanguageModelV4` with scripted responses — tests verify how the **application** treats model output, not model quality.

### Evaluation dataset

`evals/datasets/contract-qa.v1.json` (versioned): a synthetic 6-page SaaS agreement (fictional parties, includes an injection line), 15 answerable questions with expected pages and phrases, 3 unanswerable controls, and expected risk categories.

`npm run eval` measures retrieval; `npm run eval -- --with-llm` additionally measures citation coverage, citation validity, citation correctness, abstention accuracy, LLM-judged faithfulness, risk-category recall and false identifications, and finding evidence coverage. Unmeasured metrics are reported as `null`.

**Measured so far** (retrieval only, 2026-11-25; `EMBEDDING_PROVIDER=local-hash`, 120-token chunks → 15 chunks):

| Metric | Value |
|---|---|
| recall@1 | 0.867 (misses q10, q15) |
| recall@3 | 1.000 |
| MRR | ≈ 0.92 |
| Empty retrieval context on unanswerable questions | 0.333 |

Caveats: 15 questions on one short synthetic contract, and a lexical baseline embedder rather than a semantic model — treat these as a smoke-level baseline, not a quality claim. **Generation, faithfulness and risk metrics have not been measured** (no LLM key was available during development).

---

## Design decisions and trade-offs

| Decision | Why | Alternatives considered |
|---|---|---|
| Postgres-backed job queue | Already have Postgres; enqueueing in the same transaction as the document removes a class of consistency bugs; `SKIP LOCKED` gives safe concurrency | BullMQ/Redis (extra infra), Inngest/Trigger.dev (managed dependency) |
| Hybrid search + RRF | Legal text needs exact matches (defined terms, section numbers) *and* paraphrase matching; RRF needs no score calibration | Vector-only (misses exact terms), weighted score fusion (needs tuning), cross-encoder re-ranking (extra model/latency — a good next step) |
| HNSW index | No training step, good recall/latency, handles incremental inserts | IVFFlat (needs representative data to build lists) |
| Structure-aware chunking with offset spans | Keeps clauses intact; enables page/section-precise evidence | Fixed-size windows (split clauses), one chunk per clause (very uneven sizes) |
| Post-hoc citation + evidence validation | Cheap, deterministic guard against fabricated sources, pages and quotes | Trusting model output; provider-native citations (provider-specific, not available on all providers) |
| Per-user tenancy | Matches the auth model; simple and fully enforced | Organisations/workspaces (more schema and UI; planned) |
| No document versions table | Re-uploads are new documents; duplicates rejected by hash. Keeps every query simpler for the MVP | Versioned documents with chunks bound to a version |
| Streaming via a custom UI message stream | Text streams immediately; validated citations arrive as a typed data part after the text | Non-streamed structured answer (slower perceived latency) |
| Local disk storage behind an interface | Practical for development; the `DocumentStorage` interface makes S3/GCS a drop-in | Postgres `bytea` (bloats the DB) |

Complexity notes: chunking O(n) in sentences; RRF O(total candidates); de-duplication O(k²) on ≤ `RETRIEVAL_CANDIDATES` items; retrieval is dominated by two index scans per query phrasing; risk analysis makes 16 LLM calls per document (profile + 15 categories, concurrency 3).

---

## Known limitations / remaining work

**External dependencies (blocking full end-to-end validation)**
- **No LLM run yet.** Chat and risk analysis are implemented, tested with mock models and verified in the UI with a scripted reviewer, but have **not been run against DeepSeek** (or any real model). Add `DEEPSEEK_API_KEY` and run `npm run eval -- --with-llm`, then review the prompts against real outputs.
- **Embeddings need `OPENAI_API_KEY`.** DeepSeek offers no embeddings. Without OpenAI, only the dev-only `local-hash` embedder is available. A self-hosted embedding model would be an alternative.

**Product / engineering**
- No OCR: scanned PDFs fail with a clear message.
- DOCX originals are downloadable, not rendered; the viewer shows the indexed text for DOCX.
- PDF viewing uses the browser's built-in viewer (page jumps, no in-PDF highlighting); the "Indexed text" view highlights evidence.
- Rate limiting is in-memory (per instance); use Redis/Postgres for multi-instance deployments.
- Per-user tenancy only; organisations/sharing not implemented.
- Multi-document retrieval is supported by the service and API layer, but the UI chats with one document at a time.
- No email verification or password reset flows.
- `npm audit` reports a moderate esbuild dev-server advisory pulled in by `drizzle-kit` (migration CLI). CasePilot never runs esbuild's dev server; the suggested fix is a breaking downgrade, so it is left as-is.
- The evaluation set is small and synthetic; real annotated contracts are needed for meaningful quality numbers.

---

## Project structure

```
src/
  app/                      pages (route groups (auth), (app)) and API route handlers
  components/ui             design system primitives (buttons, cards, badges, alerts)
  components/{documents,workspace,risk,app}   feature components
  lib/                      client-safe domain types, chat types, formatting
  server/
    config/env.ts           validated configuration
    db/                     Drizzle client + schema (auth, documents, activity)
    auth/                   better-auth instance and session helpers
    documents/              upload, validation, processing pipeline, queries
    extraction/             PDF/DOCX extraction, normalisation, section detection
    chunking/               structure-aware chunker
    ai/                     model registry (DeepSeek/Anthropic/OpenAI) and embedders
    retrieval/              hybrid retrieval + pure ranking utilities
    rag/                    prompts, citation validation, RAG service, streamed chat turn
    risk/                   playbook, schemas, prompts, evidence verification, service
    conversations/          conversation + message persistence
    jobs/                   Postgres job queue and worker
    http/                   error envelope, CSRF origin check, rate limiting
  proxy.ts                  optimistic auth redirect
  instrumentation.ts        starts the in-process worker in development
scripts/                    migrate, worker, eval
drizzle/                    SQL migrations
evals/datasets/             versioned evaluation datasets
tests/{unit,integration,support}
```
