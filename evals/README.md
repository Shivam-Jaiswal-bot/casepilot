# CasePilot evaluation

How CasePilot's retrieval, grounded answers and risk analysis are measured, what was measured, and what the numbers do **not** show.

## Running

```bash
npm run db:up && npm run db:migrate:test             # evaluation uses TEST_DATABASE_URL only
npm run eval                                          # retrieval only (embeddings, no LLM)
npm run eval -- --with-llm --provider openai --model gpt-6-luna --judge openai:gpt-6-luna --risk-repeats 3
npm run eval -- --self-test                           # fake API: validates the harness, measures nothing
npm run eval:rescore -- evals/results/<report>.json   # re-score a stored report with the current metrics (no model calls)
npm run eval:compare -- <a>.json <b>.json --split all|dev|holdout
```

Options: `--dataset`, `--k` (answer context size, default 5), `--recall-ks 1,3,5,8`, `--risk-repeats n`, `--contracts a,b`, `--split dev|holdout`, `--skip-answers`, `--skip-risk`, `--label`. Reports are written to `evals/results/` with every per-question and per-run row, so any metric can be audited or recomputed.

## Dataset — `datasets/contract-qa.v3.json`

Four synthetic contracts with fictional parties, rendered to real PDF/DOCX files so the actual extractors run.

| Contract | Split | Format | Questions (unanswerable) | Notes |
|---|---|---|---|---|
| helios-msa | dev | PDF, 6 pages | 18 (3) | v2 contract, labels unchanged |
| orchard-supply | dev | DOCX | 13 (2) | v2 contract, labels unchanged |
| northwind-platform | holdout | PDF, 16 pages | 23 (5) | order of precedence, two conflicting-clause pairs, undefined "Material Change", "without undue delay" |
| meridian-distribution | holdout | DOCX | 18 (4) | exclusivity undermined by direct online sales, conflicting renewal vs termination notice, one-sided caps |

- **72 questions**, tagged `lookup` (47), `conflict` (5), `cross-reference` (2), `ambiguous` (4), `unanswerable` (14).
- **Dev vs holdout.** The dev contracts' severity mismatches were studied while changing the risk prompt, so dev numbers are optimistic for that change. Holdout labels (answer keys, severity bands, expected categories and evidence phrases) were written **before any model ran on those contracts**. After the "after" run below, the holdout has been seen too; further tuning on it would need a new holdout.
- **Labels:** `answerKeys` / `answerKeyGroups` (every group must match; any key within a group), expected pages/phrases for retrieval, `expectedPhrasesAll` for conflict questions (both sides must be retrieved), expected / not-expected clause categories, an acceptable severity band per category from the stated reviewing perspective, and `evidencePhrases` per category. Bands are one author's judgement, not ground truth. A unit test checks every label phrase actually occurs in its contract.

## Metrics

| Area | Metric | Definition |
|---|---|---|
| Retrieval | recall@1/3/5/8, MRR | rank of the first chunk that covers an expected page and contains an expected phrase |
| | full-evidence recall | conflict / cross-reference questions: every required passage is in the top-k answer context |
| Answers | correctness | deterministic proxy: answer-key match for answerable questions; a decline for unanswerable ones |
| | abstention accuracy / false-abstention rate | unanswerable questions declined / answerable questions refused |
| | citation validity, correctness, precision, coverage | markers resolve to retrieved sources / at least one cited source is relevant / share of cited sources that are relevant / share of substantive sentences carrying a citation |
| | numeric grounding | every number an answer states appears in a source **that sentence cites** (deterministic) |
| | faithfulness | claim-level judge: share of the answer's factual claims supported by the sources |
| Risk | clause recall / precision | expected categories identified / categories that should be absent not identified |
| | severity agreement, distance, over/under rate | most severe finding per category vs its band; rank distance and direction of misses ("no findings" = INFORMATIONAL) |
| | severity stability | share of (contract, category) pairs with the same severity in every repeated run |
| | evidence coverage | a verified quote for the category contains an expected evidence phrase |
| | finding verification rate | findings kept / findings proposed (unverifiable quotes are discarded) |
| | structured-output validity | category evaluations that parsed and validated |
| Cost | calls, tokens, USD, p50/p95 latency | from metered model calls and `pricing.json`; judge cost reported separately |

## Results — 2026-11-25, OpenAI `gpt-6-luna` (effort medium) + `text-embedding-3-small`, k = 5, 3 risk repeats

`baseline` = code before the severity work; `after` = severity factors + calibration + revised rubric. Both reports were re-scored with the same final metric code (`*-rescored.json`). The answer pipeline was not changed between the runs, so answer differences are run-to-run noise.

| Metric | Baseline (all / holdout) | After (all / holdout) |
|---|---|---|
| Retrieval recall@1 / @3 / @5 / @8 | 0.776 / 0.966 / 0.983 / 1 (holdout 0.688 / 0.938 / 0.969 / 1) | same (retrieval unchanged) |
| Retrieval MRR | 0.869 / 0.809 | same |
| Full-evidence recall (5 conflict + 2 cross-ref questions) | 1 / 1 | same |
| Answer correctness (72 questions) | 0.972 / 0.951 | 0.972 / 0.951 |
| — conflict questions (5) | 0.8 | 0.8 |
| Abstention accuracy (14 unanswerable) | 1 / 1 | 1 / 1 |
| False-abstention rate | 0 | 0 |
| Citation validity / correctness / precision | 1 / 0.983 / 0.925 | 1 / 0.983 / 0.925 |
| Citation coverage | 0.874 | 0.905 |
| Numeric grounding | 0.885 | 0.917 |
| Faithfulness (self-judged, see caveats) | 0.978 | 0.996 |
| Clause recall / precision | 1 / 1 | 1 / 1 |
| **Severity agreement** | **0.771 / 0.787** | **0.806 / 0.800** |
| Mean severity distance | 0.229 / 0.213 | 0.194 / 0.200 |
| Over- / under-severity rate | 0.215 / 0.014 | 0.132 / 0.063 |
| **Severity stability (3 runs)** | **0.708 / 0.760** | **0.542 / 0.520** |
| Risk evidence coverage | 1 | 1 |
| Finding verification rate | 1 (287 kept) | 1 (242 kept) |
| Calibration adjustments | — | 5 (all HIGH → MEDIUM on "standard" terms) |
| Structured-output validity | 1 | 1 |
| Calls (failed) / cost excl. judge | 264 (0) / $0.105 | 264 (0) / $0.107 (judge: 58 calls, $0.010) |
| Answer latency p50 / p95 | 1357 / 2908 ms | 1289 / 2005 ms |
| Risk call latency p50 / p95 | 6056 / 13125 ms | 6673 / 16147 ms |

**Reading the severity result honestly.** Over-severity on low-risk categories fell (confidentiality, governing law, IP, dispute resolution, a buyer-favourable indemnity), mostly because of the revised rubric — the deterministic clamp fired only 5 times. But some judgements moved too low (helios dispute resolution INFORMATIONAL vs LOW–MEDIUM), limitation of liability drifted up to CRITICAL (6 of 9 runs across three contracts, vs 2 of 9 before; the model counts carved-out indemnities as uncapped liability), and **run-to-run stability got worse**. On the holdout the agreement gain is 1 judgement in 75 — within noise. The change is not a demonstrated improvement in consistency.

**Remaining answer failures (after):** `n13` — retrieval missed §4.3 (suspension) in the top 5, so the model correctly said it was not found; `m06` — answered 30 days and missed the conflicting six-month non-renewal notice. Two dev answers contain numbers absent from the cited source (`q12` "20", `s11` "80%"), which the judge did not flag.

**Metric fixes made during this work** (all applied to both runs via `eval:rescore`): `2×` vs `2x` and markdown emphasis in answer keys; declines phrased "No X is identified / was found" and "do not identify"; "no findings" vs INFORMATIONAL in stability. Each was found by reading wrong verdicts, and each has a unit test. This is the expected failure mode of keyword proxies; disagreements should be read row by row in the report.

## Caveats

- Four short synthetic contracts and 72 questions. Enough to catch regressions and compare configurations on equal footing; **not** evidence of real-world accuracy or production readiness.
- Answer correctness and decline detection are keyword/regex proxies.
- The faithfulness judge is the model under test (self-grading inflates scores; it missed two ungrounded numbers that numeric grounding caught). Use one fixed, different judge for any comparison you rely on.
- Severity bands are single-annotator labels, and two v2 labels are debatable (German law + Munich courts for a US buyer; mutual 180-day termination for convenience).
- Severity stability with 3 repeats per contract is a coarse estimate.
- DeepSeek has not been measured (no key).
