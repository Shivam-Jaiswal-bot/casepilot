# CasePilot

AI-powered legal document intelligence. Upload long contracts (PDF or DOCX), ask questions and get answers grounded in the document with **verifiable page-level citations**, and run a **contract risk analysis** whose every finding quotes the contract.

> CasePilot provides AI-assisted analysis, not legal advice. Every conclusion links back to source text so a qualified reviewer can verify it.

**Status:** MVP feature-complete, ready for a **supervised pilot on real contracts**, not for production use. Verified with automated tests (151 passing), a production build, a live browser check of GPT-6 Luna streaming, and a **live evaluation with OpenAI GPT-6 Luna + text-embedding-3-small** on four synthetic contracts (see [Testing and evaluation](#testing-and-evaluation)). Severity consistency is a known open problem. The DeepSeek side of the provider comparison is pending a DeepSeek API key.

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
| AI | Vercel AI SDK 7 — OpenAI (`gpt-6-luna`), DeepSeek (`deepseek-v4-pro`) or Anthropic for generation; OpenAI `text-embedding-3-small` for embeddings |
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
| Upload + indexing | `OPENAI_API_KEY` (embeddings: `text-embedding-3-small`) — required with every LLM provider; DeepSeek has no embeddings API |
| Chat + risk analysis | The key of the active `LLM_PROVIDER`: `OPENAI_API_KEY` for `openai`, `DEEPSEEK_API_KEY` for `deepseek` (current default) |

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
| `LLM_PROVIDER` | `deepseek` | `deepseek` \| `openai` \| `anthropic`. Switch to OpenAI with `LLM_PROVIDER=openai` |
| `LLM_MODEL` | provider default | openai → `gpt-6-luna`; deepseek → `deepseek-v4-pro`; anthropic → `claude-opus-5-5`. Never an embedding model |
| `LLM_UTILITY_MODEL` | provider default | Follow-up question rewriting (always at low effort); openai → `gpt-6-luna`; deepseek → `deepseek-flash` |
| `LLM_EFFORT` | `medium` | OpenAI: passed through as `reasoningEffort`; DeepSeek: mapped to low/high/max |
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

### LLM providers

| | OpenAI `gpt-6-luna` | DeepSeek `deepseek-v4-pro` |
|---|---|---|
| API | Responses API (`openai(id)`) | Responses API (`deepseek.responses(id)`) |
| Structured outputs (risk analysis) | JSON schema, **strict** — enforced server-side | JSON schema, **not strict** (the provider's `strictJsonSchema` only exists for Chat Completions) — malformed output is rejected client-side by Zod and recorded as a category `ERROR` |
| Effort | `reasoningEffort` = `LLM_EFFORT` | `reasoningEffort` low/high/max |
| Data retention | `store: false` (responses not retained by OpenAI) | provider default |
| Other | reasoning summaries disabled (never shown; saves tokens); no `temperature` sent (only allowed at effort `none`) | legacy `deepseek-chat`/`deepseek-reasoner` aliases were retired in July 2026 |

Both providers are verified by offline **provider contract tests** (`tests/integration/provider-contract.test.ts`) that run the real `@ai-sdk/openai` / `@ai-sdk/deepseek` packages against a fake Responses API: request shape, strict-schema compliance of every risk schema, SSE streaming, and that citation validation and evidence verification work on each provider's parsed output.

### Embeddings

The LLM and the embedding model are separate. `text-embedding-3-small` at 1536 dimensions embeds **both** document chunks and user queries; every chunk records the embedder that produced it (`metadata.embeddingModel`, e.g. `openai:text-embedding-3-small@1536`). The vector search only compares a query against chunks from the **same** embedder; documents indexed with another model remain searchable via full-text search until re-indexed. After changing the embedding model, `npm run embeddings -- --reindex` re-embeds **only** the affected documents. Switching the LLM provider never requires re-embedding, and the schema (`vector(1536)`) is unchanged.

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
| `npm run eval` | Retrieval evaluation (`-- --with-llm` adds answers, risk, cost and latency; `--provider`, `--model`, `--judge provider:model`, `--risk-repeats n`, `--self-test`) — see [`evals/README.md`](evals/README.md) |
| `npm run eval:compare -- a.json b.json [--split dev\|holdout]` | Side-by-side Markdown comparison of evaluation reports |
| `npm run eval:rescore -- report.json` | Re-score a stored report with the current metrics (no model calls) |
| `npm run embeddings` | List documents embedded with a different model than configured (`-- --reindex` re-embeds only those) |

Migrations live in `drizzle/`: `0000_enable_pgvector.sql` (extension), `0001_initial_schema.sql` (tables, HNSW + GIN indexes, generated `tsvector`, partial unique index on active jobs) and `0002_severity_rationale.sql` (one nullable `jsonb` column on `risk_findings`).

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
- **Stop** aborts the request, and the abort is propagated to the model call, so nothing is generated (or billed) after the user stops. The text streamed so far is stored as a partial answer flagged `interrupted` and shown with a "Response stopped" note.

### 5. Contract risk analysis (`src/server/risk`)

`profile (parties, type) → per category (15): playbook queries → hybrid retrieval → structured evaluation (Zod) → evidence verification → persisted report`

- Categories: termination, indemnification, limitation of liability, confidentiality, IP, data protection, payment, automatic renewal, governing law, dispute resolution, assignment, warranties, non-compete/exclusivity, force majeure, breach/remedies.
- Each finding: category, title, severity (CRITICAL…INFORMATIONAL), explanation, basis (EXPLICIT vs INTERPRETATION), evidence quotes, business implication, review suggestion, confidence.
- **Evidence verification:** every quote must be found in the chunk it cites — verbatim after normalisation (`EXACT`) or ≥ 85 % trigram overlap (`NEAR`). Findings without a verified quote are **discarded and counted**. Quotes are pinned to the exact page/section via the chunk's offset spans.
- **"Not identified" is not a finding.** A category counts as identified only if the model supplies *verifiable* clause quotes — the model claiming a clause exists is not enough. Absent categories are reported as "Not identified in the reviewed content", never as defects.
- **Severity calibration** (`severity-calibration.ts`): for every finding the model also reports three factors — direction (adverse / balanced / favourable to the reviewing party), exposure (severe … none) and market position (standard / deviates / unusual). A pure function derives the severity range those factors allow (e.g. a provision that favours the reviewing party is at most LOW; a customary term at most MEDIUM; adverse, severe, off-market exposure at least HIGH) and clamps the model's label into it. The factors, the model's original label and whether it was adjusted are stored with the finding (`severity_rationale`) and shown on the finding page.
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
npm test          # 16 files, 151 tests (111 unit + 40 integration against real Postgres)
```

| Suite | Covers |
|---|---|
| `tests/unit` | file validation, PDF/DOCX extraction (real generated files: multi-page, scanned, corrupt, empty), normalisation & headings, chunking (limits, metadata, overlap, dangling headings, spans), RRF / dedup / budgeting / tsquery, citation validation (incl. grouped `[S1, S2]` and trailing markers), prompt-injection hardening, evidence verification & location, severity calibration (every factor combination, borderline and ambiguous cases), Zod output schemas, env validation, provider/model resolution, OpenAI embedding request contract and dimension guard, evaluation metrics, rate limiting, retry policy, log redaction |
| `tests/integration` | upload → job → chunks with embeddings and metadata; DOCX; idempotent re-processing; retries; cascade delete; ownership; hybrid retrieval; tenant isolation; metadata filtering; grounded answers + citation validation; abstention without model calls; streamed chat turns; stopping a response mid-stream (generation aborted, partial answer stored as interrupted); risk analysis (verified findings, discarded fabrications, not-identified handling, severity calibration stored with its rationale, idempotency, failures); API routes; **provider contract tests for OpenAI and DeepSeek**; **embedding-model consistency** (no cross-model vector comparison, re-embed only stale documents) |

Unit and integration tests use mock models or a fake Responses API — they verify how the **application** handles model output, not model quality. Model quality is measured by the evaluation harness.

### Evaluation harness

Full method, dataset description, metric definitions and results: **[`evals/README.md`](evals/README.md)**.

- Dataset `evals/datasets/contract-qa.v3.json`: four synthetic contracts (2 PDF, 2 DOCX, up to 16 pages), 72 questions — lookups, cross-references, conflicting clauses, ambiguous provisions and 14 unanswerable questions — split into **dev** (the v2 contracts, labels unchanged) and **holdout** (labelled before any model ran on them).
- Metrics: recall@1/3/5/8, MRR, full-evidence recall for conflict questions; answer correctness by question type, abstention and false-abstention; citation validity, correctness, precision and coverage; numeric grounding; claim-level faithfulness; clause recall/precision; severity agreement, distance, over/under-severity and **stability across repeated runs**; risk evidence coverage; finding verification rate; structured-output validity; cost and latency.

### Measured results (2026-11-25, `gpt-6-luna` + `text-embedding-3-small`, k = 5, 3 risk repeats)

| Metric | Before severity work | After |
|---|---|---|
| Retrieval recall@1 / @5 / MRR | 0.776 / 0.983 / 0.869 | unchanged |
| Answer correctness (72) / conflict questions (5) | 0.972 / 0.8 | 0.972 / 0.8 |
| Abstention accuracy (14 unanswerable) / false abstentions | 1 / 0 | 1 / 0 |
| Citation correctness / precision | 0.983 / 0.925 | 0.983 / 0.925 |
| Numeric grounding / faithfulness (self-judged) | 0.885 / 0.978 | 0.917 / 0.996 |
| Clause recall / precision | 1 / 1 | 1 / 1 |
| Severity agreement — all / holdout | 0.771 / 0.787 | 0.806 / 0.800 |
| Over- / under-severity rate | 0.215 / 0.014 | 0.132 / 0.063 |
| **Severity stability across 3 runs** | **0.708** | **0.542** |
| Risk evidence coverage / finding verification | 1 / 1 | 1 / 1 |
| Structured-output validity | 1 | 1 |
| Cost per full run (264 calls) | $0.105 | $0.107 |

The severity work reduced over-rating of low-risk clauses but is **not a demonstrated consistency improvement**: the holdout gain is within noise, some judgements moved too low, limitation of liability drifted towards CRITICAL, and run-to-run stability fell. Details and remaining failures are in `evals/README.md`.

**Browser check (live GPT-6 Luna, dev server):** tokens stream incrementally (first token ≈ 1.9 s, 136 deltas over ≈ 0.7 s); validated citation chips render after the text; Stop aborts generation and stores the partial answer as interrupted; a provider error shows a friendly message without leaking details; reloading preserves the conversation, and a follow-up ("Which of those notice periods is the shortest?") is resolved from history.

**DeepSeek `deepseek-v4-pro`: not yet measured** (no `DEEPSEEK_API_KEY`). Run:

```bash
npm run eval -- --with-llm --provider deepseek --model deepseek-v4-pro --judge openai:gpt-6-luna --risk-repeats 3
npm run eval:compare -- evals/results/<gpt-6-luna report>.json evals/results/<deepseek report>.json
```

Published prices (standard tier, per 1M tokens): gpt-6-luna $0.10 in / $0.01 cached / $0.50 out; deepseek-v4-pro $1.32 in / $0.044 cached / $3.96 out at peak (half off-peak) — at equal token usage roughly 10× (peak) or 5× (off-peak) the cost; a projection from list prices, not a measurement.

**Caveats:** four short synthetic contracts — enough to catch regressions and compare configurations, not evidence of real-world accuracy. Correctness and decline detection are keyword/regex proxies; the faithfulness judge is the model under test; severity bands are single-annotator labels.

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

**Provider evaluation**
- **DeepSeek not yet measured.** The GPT-6 Luna side of the provider comparison has been run live; DeepSeek needs `DEEPSEEK_API_KEY`. DeepSeek remains the configured default and fully supported until that comparison is complete.
- **Small, synthetic evaluation set.** Four contracts, 72 questions; keyword-based correctness; single-annotator severity bands; self-judged faithfulness. Not a basis for production-readiness claims.

**AI quality**
- **Severity consistency is not solved.** Agreement with labelled bands is ~0.8 and repeated runs give the same per-category severity only ~54% of the time. Aggregating several runs, a different effort level, or per-category calibration examples are untested options; real lawyer-labelled contracts are needed to tune any of them.
- **Limitation of liability is over-rated** (often CRITICAL) when indemnities are carved out of the cap.
- **Conflicting clauses:** the answer prompt has no explicit instruction to surface conflicts; one of five conflict questions reported only one side.
- **Retrieval misses** remain at k = 5 on the longer contract (recall@5 0.969 on the holdout; recall@1 0.688).
- A stopped answer is stored as streamed by the server, which can be a sentence ahead of what the browser displayed. A failed answer leaves the question in history without a reply.
- **DeepSeek structured outputs are not schema-enforced server-side** (non-strict JSON schema on its Responses API); invalid output is caught by Zod and surfaces as a per-category `ERROR`.
- **Embeddings require `OPENAI_API_KEY`** with every LLM provider. Documents indexed during development with the `local-hash` embedder must be re-embedded once (`npm run embeddings -- --reindex`).

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
