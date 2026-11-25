import { APIUserAbortError } from "@anthropic-ai/sdk";
import {
  END,
  isGraphBubbleUp,
  MemorySaver,
  ReducedValue,
  Send,
  START,
  StateGraph,
  StateSchema,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { z } from "zod";
import {
  ERROR_KIND,
  FINDING_SOURCE,
  MAX_CONCURRENCY,
  PLAYBOOK,
  RULE_ID,
  STREAM_EVENT,
  type RuleId,
} from "@/common/constants";
import type { Citation } from "@/features/citations/types";
import { segmentDocument } from "@/features/document/segment";
import type { Clause } from "@/features/document/types";
import { computeCoverage, type Coverage } from "@/features/review/coverage";
import type { Finding, FindingError, Redline } from "@/features/review/finding";
import { ZERO_USAGE, type ModelClient, type TokenUsage } from "./callModel";
import { detectRule } from "./detector";
import { emitFinding, errorFinding } from "./emit";
import { mapClauses, type MapClausesResult } from "./mapClauses";
import {
  createReviewDocument,
  initialRuleState,
  type CitationFailure,
  type Claim,
  type Proposals,
  type RuleReviewContext,
  type RuleReviewState,
  type TriggerHit,
} from "./state";
import { verifyFinding } from "./verifier";
import { AFTER_VERIFY_CITATIONS, routeAfterVerifyCitations, verifyCitations } from "./verifyCitations";

/**
 * LangGraph wiring only (ADR 0001): every node delegates to a plain step
 * function. `segment` → Send per Rule to `reviewRule` (which runs the per-rule
 * subgraph) plus one Send to `mapClauses` → `assemble`.
 *
 * The model client and name travel as runtime context, never in state, so
 * checkpoints hold only plain data. The Document is rebuilt per node from
 * `text` + `clauses` (the citation index is cheap and not serializable).
 */

/* ------------------------------------------------------------------------ */
/* Run context and stream events                                             */
/* ------------------------------------------------------------------------ */

/** Per-run dependencies, passed as LangGraph runtime context. */
export interface ReviewRunContext {
  readonly client: ModelClient;
  readonly model: string;
}

const ReviewRunContextSchema = z.object({
  client: z.custom<ModelClient>((value) => typeof (value as Partial<ModelClient> | null)?.create === "function"),
  model: z.string().min(1),
});

type NodeConfig = LangGraphRunnableConfig<ReviewRunContext>;

/** Chunks written to the `custom` stream. `done` is the route's, not the graph's. */
export type ReviewStreamChunk =
  | { readonly event: typeof STREAM_EVENT.CLAUSES; readonly clauses: readonly Clause[] }
  | { readonly event: typeof STREAM_EVENT.FINDING; readonly finding: Finding }
  | { readonly event: typeof STREAM_EVENT.COVERAGE; readonly coverage: Coverage };

function write(config: NodeConfig, chunk: ReviewStreamChunk): void {
  config.writer?.(chunk);
}

function ruleContext(state: { text: string; clauses: readonly Clause[] }, config: NodeConfig): RuleReviewContext {
  const run = config.context;
  if (!run) throw new Error("Review graph invoked without a run context.");
  return {
    client: run.client,
    model: run.model,
    document: createReviewDocument(state.text, state.clauses),
    signal: config.signal,
  };
}

/** Errors that must end the run instead of becoming an ERROR Finding. */
function endsRun(error: unknown, config: NodeConfig): boolean {
  return error instanceof APIUserAbortError || isGraphBubbleUp(error) || config.signal?.aborted === true;
}

/* ------------------------------------------------------------------------ */
/* Per-rule subgraph                                                         */
/* ------------------------------------------------------------------------ */

const value = <T>() => z.custom<T>();

const RuleReviewGraphState = new StateSchema({
  ruleId: z.enum(RULE_ID),
  text: z.string(),
  clauses: value<readonly Clause[]>(),
  attempts: z.number(),
  claim: value<Claim | null>(),
  source: z.enum(FINDING_SOURCE),
  proposals: value<Proposals | null>(),
  citations: value<readonly Citation[]>(),
  citationFeedback: value<readonly CitationFailure[]>(),
  redline: value<Redline | null>(),
  triggerHits: value<readonly TriggerHit[]>(),
  verifierNote: value<string | null>(),
  error: value<FindingError | null>(),
  firstPassCitations: value<RuleReviewState["firstPassCitations"]>(),
  usage: value<RuleReviewState["usage"]>(),
  finding: value<Finding | null>(),
});

/** Exported for tests; the app only runs it through `reviewRule`. */
export function buildRuleReviewGraph() {
  return new StateGraph(RuleReviewGraphState, ReviewRunContextSchema)
    .addNode(AFTER_VERIFY_CITATIONS.REPAIR, (state, config) => detectRule(state, ruleContext(state, config)))
    .addNode("verifyCitations", (state, config) => verifyCitations(state, ruleContext(state, config)))
    .addNode(AFTER_VERIFY_CITATIONS.VERIFY_FINDING, (state, config) => verifyFinding(state, ruleContext(state, config)))
    .addNode(AFTER_VERIFY_CITATIONS.EMIT, (state, config) => ({ finding: emitFinding(state, ruleContext(state, config)) }))
    .addEdge(START, AFTER_VERIFY_CITATIONS.REPAIR)
    .addEdge(AFTER_VERIFY_CITATIONS.REPAIR, "verifyCitations")
    .addConditionalEdges("verifyCitations", routeAfterVerifyCitations, Object.values(AFTER_VERIFY_CITATIONS))
    .addEdge(AFTER_VERIFY_CITATIONS.VERIFY_FINDING, AFTER_VERIFY_CITATIONS.EMIT)
    .addEdge(AFTER_VERIFY_CITATIONS.EMIT, END)
    .compile();
}

/* ------------------------------------------------------------------------ */
/* Parent graph                                                              */
/* ------------------------------------------------------------------------ */

/** Per-rule bookkeeping for the eval: tokens per pass and first-try citation results. */
export interface RuleRun {
  readonly ruleId: RuleId;
  readonly usage: RuleReviewState["usage"];
  readonly firstPassCitations: RuleReviewState["firstPassCitations"];
}

export interface ReviewResult {
  readonly clauses: readonly Clause[];
  /** One per Rule, in Playbook order. */
  readonly findings: readonly Finding[];
  readonly coverage: Coverage;
  readonly usage: { readonly rules: readonly RuleRun[]; readonly mapClauses: TokenUsage };
}

const appended = <T>() =>
  new ReducedValue(value<readonly T[]>().default(() => []), {
    inputSchema: value<readonly T[]>(),
    reducer: (current: readonly T[], next: readonly T[]) => [...current, ...next],
  });

const ReviewGraphState = new StateSchema({
  text: z.string(),
  clauses: value<readonly Clause[]>().default(() => []),
  findings: appended<Finding>(),
  ruleRuns: appended<RuleRun>(),
  clauseMap: value<MapClausesResult | null>().default(null),
  result: value<ReviewResult | null>().default(null),
});
type ReviewGraphStateValue = typeof ReviewGraphState.State;

/** Send payload for one Rule. */
const RuleTaskState = new StateSchema({
  ruleId: z.enum(RULE_ID),
  text: z.string(),
  clauses: value<readonly Clause[]>(),
});
type RuleTask = typeof RuleTaskState.State;

const NODE = {
  SEGMENT: "segment",
  REVIEW_RULE: "reviewRule",
  MAP_CLAUSES: "mapClauses",
  ASSEMBLE: "assemble",
} as const;

function segment(state: ReviewGraphStateValue, config: NodeConfig) {
  const clauses = segmentDocument(state.text);
  write(config, { event: STREAM_EVENT.CLAUSES, clauses });
  return { clauses };
}

function fanOut(state: ReviewGraphStateValue): Send[] {
  const { text, clauses } = state;
  return [
    ...PLAYBOOK.map((rule) => new Send(NODE.REVIEW_RULE, { ruleId: rule.id, text, clauses } satisfies RuleTask)),
    new Send(NODE.MAP_CLAUSES, { text, clauses }),
  ];
}

const ZERO_RULE_USAGE: RuleReviewState["usage"] = { DETECT: ZERO_USAGE, REPAIR: ZERO_USAGE, VERIFY: ZERO_USAGE };

/**
 * Runs the per-rule subgraph and maps its output onto the parent's append
 * reducers. The subgraph's nodes never throw; this catch is the safety net so
 * one Rule's failure is an ERROR Finding, not a failed run.
 */
async function reviewRule(
  ruleReviewGraph: ReturnType<typeof buildRuleReviewGraph>,
  task: RuleTask,
  config: NodeConfig,
) {
  let finding: Finding;
  let run: RuleRun;
  try {
    const output = await ruleReviewGraph.invoke(
      { ...initialRuleState(task.ruleId), text: task.text, clauses: task.clauses, finding: null },
      config,
    );
    finding =
      output.finding ??
      errorFinding(task.ruleId, output.attempts, { kind: ERROR_KIND.INTERNAL, message: "No Finding emitted." });
    run = { ruleId: task.ruleId, usage: output.usage, firstPassCitations: output.firstPassCitations };
  } catch (error) {
    if (endsRun(error, config)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    finding = errorFinding(task.ruleId, 0, { kind: ERROR_KIND.INTERNAL, message });
    run = { ruleId: task.ruleId, usage: ZERO_RULE_USAGE, firstPassCitations: null };
  }
  write(config, { event: STREAM_EVENT.FINDING, finding });
  return { findings: [finding], ruleRuns: [run] };
}

async function mapClausesNode(state: ReviewGraphStateValue, config: NodeConfig) {
  return { clauseMap: await mapClauses(ruleContext(state, config)) };
}

function assemble(state: ReviewGraphStateValue, config: NodeConfig) {
  const order = (ruleId: RuleId) => PLAYBOOK.findIndex((rule) => rule.id === ruleId);
  const findings = [...state.findings].sort((a, b) => order(a.ruleId) - order(b.ruleId));
  const rules = [...state.ruleRuns].sort((a, b) => order(a.ruleId) - order(b.ruleId));

  const map = state.clauseMap;
  const tagged = map?.ok ? map.mappings.map((mapping) => mapping.clauseId) : null;
  const coverage = computeCoverage(state.clauses, tagged, findings);
  write(config, { event: STREAM_EVENT.COVERAGE, coverage });

  const result: ReviewResult = {
    clauses: state.clauses,
    findings,
    coverage,
    usage: { rules, mapClauses: map?.usage ?? ZERO_USAGE },
  };
  return { result };
}

function buildReviewGraph(checkpointer: MemorySaver) {
  const ruleReviewGraph = buildRuleReviewGraph();
  return new StateGraph(ReviewGraphState, ReviewRunContextSchema)
    .addNode(NODE.SEGMENT, segment)
    .addNode(NODE.REVIEW_RULE, (task: RuleTask, config: NodeConfig) => reviewRule(ruleReviewGraph, task, config), {
      input: RuleTaskState,
    })
    .addNode(NODE.MAP_CLAUSES, mapClausesNode)
    .addNode(NODE.ASSEMBLE, assemble)
    .addEdge(START, NODE.SEGMENT)
    .addConditionalEdges(NODE.SEGMENT, fanOut, [NODE.REVIEW_RULE, NODE.MAP_CLAUSES])
    .addEdge(NODE.REVIEW_RULE, NODE.ASSEMBLE)
    .addEdge(NODE.MAP_CLAUSES, NODE.ASSEMBLE)
    .addEdge(NODE.ASSEMBLE, END)
    .compile({ checkpointer });
}

/* ------------------------------------------------------------------------ */
/* Running a review                                                          */
/* ------------------------------------------------------------------------ */

const checkpointer = new MemorySaver();
let compiled: ReturnType<typeof buildReviewGraph> | undefined;

/** The one compiled graph, shared by the route and the eval CLI. */
export function getReviewGraph() {
  compiled ??= buildReviewGraph(checkpointer);
  return compiled;
}

/** Run config (DESIGN "Run config"): one fresh thread per review. */
export function reviewRunConfig(context: ReviewRunContext, signal?: AbortSignal) {
  return {
    context,
    signal,
    maxConcurrency: MAX_CONCURRENCY,
    configurable: { thread_id: crypto.randomUUID() },
  };
}

/** Checkpoints only matter during a run; drop them so memory doesn't grow per review. */
async function releaseThread(config: ReturnType<typeof reviewRunConfig>): Promise<void> {
  await checkpointer.deleteThread(config.configurable.thread_id);
}

/** Runs a whole review and returns the assembled result (eval CLI). */
export async function runReview(text: string, context: ReviewRunContext, signal?: AbortSignal): Promise<ReviewResult> {
  const config = reviewRunConfig(context, signal);
  try {
    const output = await getReviewGraph().invoke({ text }, config);
    if (!output.result) throw new Error("Review graph finished without a result.");
    return output.result;
  } finally {
    await releaseThread(config);
  }
}

/** Streams `clauses` → `finding` (one per Rule) → `coverage` (route). */
export async function* streamReview(
  text: string,
  context: ReviewRunContext,
  signal?: AbortSignal,
): AsyncGenerator<ReviewStreamChunk> {
  const config = reviewRunConfig(context, signal);
  try {
    const stream = await getReviewGraph().stream({ text }, { ...config, streamMode: "custom" });
    for await (const chunk of stream) yield chunk as ReviewStreamChunk;
  } finally {
    await releaseThread(config);
  }
}
