# NDA Review: design (agreed before implementation)

Vocabulary: see `GLOSSARY.md`. Key decisions: `docs/adr/`. Eval data spec: `data/README.md`.

## Goals (priority order)
1. Recall on risk detection: when unsure, flag.
2. Zero hallucinated citations (ADR 0002).
3. Fast review: seconds per Finding.
4. Redline quality: minimal, scoped to the cited Clause.

## Playbook

| Rule ID | Kind | Compliant when |
|---|---|---|
| `MUTUAL` | REQUIRED | Both parties bound as discloser and recipient on symmetric terms; asymmetric obligations ⇒ RISK_FOUND |
| `GOVERNING_LAW` | REQUIRED | Law is DE or CA; venue/forum ignored; absent ⇒ NOT_FOUND |
| `CONFIDENTIALITY_TERM` | REQUIRED | Confidentiality **survival** ≤ 2 years; indefinite trade-secret carve-out OK; perpetual/"until public" ⇒ RISK_FOUND; no duration ⇒ NOT_FOUND |
| `NO_NON_SOLICIT` | PROHIBITED | No non-solicit/no-hire of employees, customers, suppliers, including soft "won't use CI to solicit" |
| `NO_RESIDUALS` | PROHIBITED | No unaided-memory / residuals right |
| `CONFIDENTIALITY_CARVE_OUTS` | REQUIRED | All five: public, already known, independently developed, third party, compelled by law with notice; any missing ⇒ RISK_FOUND naming which; none ⇒ NOT_FOUND |

Each Rule has Trigger Terms (constants). REQUIRED absent ⇒ NOT_FOUND. PROHIBITED absent ⇒ COMPLIANT, no citation.

## Segmentation
- Input: paste, `.txt`, `.docx` (mammoth raw text; cut first if short on time). No PDF.
- Deterministic splitter at the deepest numbered marker at line start (`1.`, `1.1`, `(a)`, `(i)`, `Section 3`, `ARTICLE IV`); unnumbered text splits on blank-line paragraphs.
- Clause: `{ id: "c-001", label: "§3.2(a)", parentId, depth, start, end }`; offsets into the untouched Document text. IDs positional; stable = deterministic for the same input.

## Quote verification
- Normalize: NFKC → collapse whitespace → curly quotes to straight → en/em dash to `-` → drop soft hyphens. Case-sensitive. No ellipses (contiguous only).
- Min 20 normalized chars, or the whole Clause if shorter (`TOO_SHORT`).
- Must occur in the cited Clause; first occurrence wins. Failure reasons: `UNKNOWN_CLAUSE`, `NOT_IN_CLAUSE`, `FOUND_IN_OTHER_CLAUSE`, `TOO_SHORT`.
- Offset map from normalized → original so highlights are exact. Heaviest unit-test target.
- Quoted runs (20+ chars) in `explanation` / `verifierNote` are checked against the whole Document; unverified ones become `[unverified quote removed]`.

## Types

```ts
type Citation = { clauseId: ClauseId; start: number; end: number };  // no quote text stored
type BlockedCitation = { clauseId: ClauseId | null;
  reason: "UNKNOWN_CLAUSE" | "NOT_IN_CLAUSE" | "FOUND_IN_OTHER_CLAUSE" | "TOO_SHORT" };
type Redline =
  | { kind: "REPLACE"; clauseId: ClauseId; start: number; end: number; replacement: string }
  | { kind: "INSERT"; afterClauseId: ClauseId | null; text: string };
type Finding = {
  ruleId: RuleId; ruleKind: "REQUIRED" | "PROHIBITED";
  status: "RISK_FOUND" | "COMPLIANT" | "NOT_FOUND" | "ERROR";
  confidence: "HIGH" | "LOW";
  source: "MODEL" | "TRIGGER_TERM";
  citations: Citation[]; blockedCitations: BlockedCitation[];
  redline: Redline | null;
  explanation: string; verifierNote: string | null;
  error: { kind: "SCHEMA" | "API" | "TIMEOUT" | "REFUSAL" | "INTERNAL"; message: string } | null;
  attempts: number;
};
type Decision = { ruleId: RuleId; kind: "APPROVE" | "EDIT" | "ESCALATE" | "DISMISS";
  reason: string | null; editedReplacement: string | null; decidedAt: number; elapsedMs: number };
```

- Two schema layers: plain **model-output** Zod schemas (structured-outputs compatible, via `messages.parse` + `zodOutputFormat`), and the **domain** `Finding` schema built by our code with `superRefine` invariants: ERROR ⇔ error; COMPLIANT on PROHIBITED has no citations; NOT_FOUND only on REQUIRED; REPLACE targets a cited Clause; COMPLIANT has no redline.
- Never name a model-output field "reasoning" (triggers `reasoning_extraction` refusal).
- Derived (pure functions, never stored): recommended action, citation state.

## Recommended action → colour
- ESCALATE (red): ERROR, NOT_FOUND, citation blocked, RISK_FOUND without redline.
- FIX (amber): RISK_FOUND with redline.
- NONE (green): COMPLIANT.
- LOW confidence / Possible Miss: hollow tick, same colour.

## Graph (LangGraph JS 1.x, `StateSchema` + `ReducedValue`; ADR 0001)
1. `segment` (code).
2. Send per Rule → wrapper node `reviewRule` invoking the per-rule subgraph; plus one Send → `mapClauses` (effort low, output `{clauseId, ruleIds[]}` only).
3. Per-rule subgraph: `detectRule → verifyCitations → (repair retry ≤ CITATION_RETRIES) → verifyFinding → emit`.
   - `detectRule`: effort high. Repair mode when `citationFeedback` in state: fresh single-turn prompt with failed quotes, reasons, real cited Clause text (+ parent intro); full doc only on `UNKNOWN_CLAUSE`. Re-asks only failed quotes; status and verified citations kept. Redline target shares the budget.
   - `verifyCitations`: code. Quote verification + Trigger Term sweep (NONE + trigger hit ⇒ RISK_FOUND, LOW, `TRIGGER_TERM`).
   - `verifyFinding`: effort medium. RISK_FOUND sees cited Clauses + parents; COMPLIANT/NOT_FOUND see the full doc and may upgrade to RISK_FOUND (new quotes verified, no retry). ERROR skips. Can lower confidence or tighten status, never relax. On failure keep detector Finding, LOW, note "verifier unavailable".
   - Nodes never throw: they write `error` to state and route to `emit`. The wrapper also try/catches as a safety net. `APIUserAbortError` ends the run silently: the graph rejects with an `AbortError`, which callers treat as a cancelled review, not a failure.
4. Parent `findings` uses an append reducer; wrapper maps subgraph output onto it.
5. `assemble` (code): final result + Coverage (Clauses tagged by `mapClauses` or cited by any Finding ÷ total; "unavailable" if `mapClauses` failed).

Run config: `maxConcurrency = MAX_CONCURRENCY` (4), `MemorySaver`, `thread_id = crypto.randomUUID()`, request `AbortSignal` passed through to graph and SDK. Route runs on Node.js: Next 16 Cache Components (enabled) implies the Node runtime and forbids a `runtime` segment export.

### Retry layers
| Failure | Handled by | Constant |
|---|---|---|
| Timeout, 408/409/429/5xx, connection | Anthropic SDK `maxRetries` / `timeout` per request | `CALL_RETRIES`, `CALL_TIMEOUT_MS` |
| Invalid output / `max_tokens` stop / refusal | `callModel` helper | `SCHEMA_RETRIES` (1) |
| Citation fails verification | Subgraph `attempts` + repair edge | `CITATION_RETRIES` (1) |

### Context discipline
- Every model call is single-turn, built fresh from state. No message history, raw responses or thinking blocks in state.
- Clauses sent once as `<clause id label>…</clause>`, never alongside raw text. Document first, rule instructions after (cache-ready).
- `DETECTOR_MAX_TOKENS` 16000, `VERIFIER_MAX_TOKENS` 8000, `MAP_MAX_TOKENS` 4000. Explanation ≤ 2 sentences (prompt) + UI clamp.
- Document duplicated per Send payload and checkpoint (~1 MB/review in memory): accepted.
- No `temperature` set. Effort: detector high, verifier medium, mapClauses low.

## Streaming
`POST /api/review`, consumed with `fetch` + stream reader. `streamMode: "custom"` only (`updates` behind `DEBUG_STREAM`). Events: `clauses` (once, immediately) → `finding` (one per Rule, final only) → `coverage` → `done`.

## UI
- Viewer renders original text sliced by offsets; highlights from Citations only.
- Blocked citation card: "Agent cited §X but the quote didn't match" + real Clause text. Never the model quote.
- Explanation under an "Agent's Reasoning" label, visually distinct.
- Minimap: one tick per verified Citation at the Clause's measured position; dashed tick for blocked Citations with a real Clause ID; pinned "not in document" cluster at top for positionless Findings (click focuses the queue); grey ticks for Unmapped Clauses; decided ticks dim.
- Rule status panel and coverage bar ("38 of 41 clauses mapped"); Unmapped Clauses clickable (scroll).
- Queue: sort by action (ESCALATE → FIX → NONE), then document position, positionless first in group; sorted insert while streaming with focus pinned to Finding ID; auto-advance to next undecided after a Decision; J/K visit all; COMPLIANT at the bottom.
- Keys (constants): J/K move, A approve, E edit redline inline (jsdiff word diff of the Clause), X escalate + reason, D dismiss + optional reason. On-screen hint.
- Avg seconds per decision: focus → Decision, each capped at `IDLE_CAP_SECONDS` (60), latest Decision per Finding counts, editing time included.

## Eval CLI
- Loads the same `.env` through the config module. Runs the same compiled graph over `data/*.txt` one document at a time.
- Validates labels first (all six Rule IDs, anchors are exact substrings).
- Prints per-rule recall (Positive caught = not COMPLIANT; ERROR counts as a miss, separate column), precision, citation pass rate first-try and after-retry, tokens (input/output/thinking) per rule and pass, cost per document.

## Config & code organisation
- `.env`: `ANTHROPIC_API_KEY`, `REVIEW_MODEL`. `.env.example` committed. Config module validates with Zod at startup, fails fast.
- All other constants in one common file (playbook, statuses, colours, keys, retries, thresholds, efforts, token limits, concurrency).
- Folders: `document/`, `agent/` (prompts, detector, verifier, schemas, graph), `citations/`, `review/`, `eval/`, `components/common/`, `theme/` (reads colours from constants). Business logic out of React.
- Vitest for segmentation and verification.

## Build order (cut from the bottom)
1. Config, constants, splitter, quote verifier + tests.
2. Model-call helper, detector, verifier, graph, eval CLI.
3. Viewer with highlights, finding cards, keyboard queue, streaming route.
4. Rule status panel and coverage bar.
5. Minimap.
6. Avg-seconds counter, `.docx` upload, theme polish.

### Implementation status
One branch per row, in build order. A row is **Resolved** once its PR is raised; update the row in the same PR.

| Step | Branch | Scope | Status |
|---|---|---|---|
| 1 | `feat/scaffold-config` | Next.js scaffold, config module, constants | Resolved (#1) |
| 1 | `feat/splitter-verifier` | Clause splitter, quote verifier + tests | Resolved (#2) |
| 2 | `feat/model-call` | `callModel` helper, model-output and `Finding` schemas, derived action and citation state | Resolved (#3) |
| 2 | `feat/detector-verifier` | Prompts, `detectRule` + citation repair, `verifyCitations` + Trigger Term sweep, `verifyFinding`, `emitFinding` | Resolved (#4) |
| 2 | `docs/design-status` | Implementation status table in DESIGN.md, AGENTS.md pointer | Resolved (#5) |
| 2 | `feat/graph` | LangGraph per-rule subgraph wiring, `mapClauses`, `assemble` + Coverage, run config | Resolved (#6) |
| 2 | `feat/eval-cli` | Eval CLI over `data/*.txt`: label validation, per-rule recall/precision, citation pass rates, tokens, cost | Resolved (#7) |
| 3 | `feat/review-route` | `POST /api/review` streaming (`clauses` → `finding` → `coverage` → `done`) | Open |
| 3 | `feat/viewer` | Document viewer with Citation highlights, finding cards (incl. blocked citation card, Agent's Reasoning) | Open |
| 3 | `feat/keyboard-queue` | Review Queue ordering, J/K/A/E/X/D Decisions, inline redline edit with word diff | Open |
| 4 | `feat/rule-status-coverage` | Rule status panel, coverage bar, clickable Unmapped Clauses | Open |
| 5 | `feat/minimap` | Minimap ticks, blocked/positionless/unmapped markers | Open |
| 6 | `feat/decision-timer` | Avg seconds per Decision | Open |
| 6 | `feat/docx-upload` | `.docx` upload (mammoth raw text) | Open |
| 6 | `feat/theme-polish` | Theme polish | Open |

## README "next"
Reviewer corrections → eval cases; precision/recall sensitivity slider; auth, database, durable per-rule steps, multi-document matters; prompt caching with cache warming; re-run single rule; one-click "check this clause" for Unmapped Clauses.
