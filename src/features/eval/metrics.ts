import { FINDING_STATUS, PLAYBOOK, type FindingStatus, type ModelPricing, type RuleId } from "@/common/constants";
import { addUsage, ZERO_USAGE, type TokenUsage } from "@/features/agent/callModel";
import type { ReviewResult } from "@/features/agent/graph";
import { MODEL_PASS, type ModelPass } from "@/features/agent/state";
import type { Finding } from "@/features/review/finding";
import type { ExpectedStatus, LabeledDocument } from "./labels";

/**
 * Pure scoring for the eval CLI (DESIGN "Eval CLI"). A Positive is a label
 * expecting RISK_FOUND or NOT_FOUND; it is caught when the Finding is anything
 * but COMPLIANT, except ERROR, which is always a miss and counted separately.
 */

export interface DocumentRun {
  readonly document: LabeledDocument;
  readonly result: ReviewResult;
}

/** `hit` of `total`; the rate is undefined when `total` is 0. */
export interface Ratio {
  readonly hit: number;
  readonly total: number;
}

export const rate = (ratio: Ratio): number | null => (ratio.total === 0 ? null : ratio.hit / ratio.total);

const addRatio = (a: Ratio, b: Ratio): Ratio => ({ hit: a.hit + b.hit, total: a.total + b.total });
const ZERO_RATIO: Ratio = { hit: 0, total: 0 };

export type PassUsage = Readonly<Record<ModelPass, TokenUsage>>;
const ZERO_PASS_USAGE: PassUsage = { DETECT: ZERO_USAGE, REPAIR: ZERO_USAGE, VERIFY: ZERO_USAGE };
const MODEL_PASSES = Object.values(MODEL_PASS);

export interface RuleMetrics {
  /** Caught Positives ÷ Positives. */
  readonly recall: Ratio;
  /** Flagged Findings that are Positives ÷ flagged Findings (RISK_FOUND or NOT_FOUND). */
  readonly precision: Ratio;
  /** Finding Status equals the expected Status. */
  readonly exact: Ratio;
  /** ERROR Findings, over all labels. */
  readonly errors: number;
  /** Verified ÷ proposed quotes on the detector's first pass. */
  readonly citationsFirstTry: Ratio;
  /** Final Citations ÷ (Citations + Blocked Citations) on the emitted Findings. */
  readonly citationsFinal: Ratio;
  readonly usage: PassUsage;
}

export interface DocumentCost {
  readonly name: string;
  readonly usage: TokenUsage;
  /** Null when the model has no price in `MODEL_PRICING`. */
  readonly costUsd: number | null;
}

export interface EvalSummary {
  readonly rules: Readonly<Record<RuleId, RuleMetrics>>;
  /** Micro-averaged over every Rule. */
  readonly total: RuleMetrics;
  readonly mapClauses: TokenUsage;
  readonly documents: readonly DocumentCost[];
  /** Null when any Document's cost is unknown. */
  readonly totalCostUsd: number | null;
}

export const OUTCOME = {
  CAUGHT: "CAUGHT",
  MISS: "MISS",
  FALSE_POSITIVE: "FALSE_POSITIVE",
  CORRECT_NEGATIVE: "CORRECT_NEGATIVE",
  ERROR: "ERROR",
} as const;
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];

export interface RuleComparison {
  readonly ruleId: RuleId;
  readonly expected: ExpectedStatus;
  readonly actual: FindingStatus;
  readonly outcome: Outcome;
  readonly exact: boolean;
}

export const isPositive = (status: ExpectedStatus | FindingStatus): boolean =>
  status === FINDING_STATUS.RISK_FOUND || status === FINDING_STATUS.NOT_FOUND;

export function outcomeOf(expected: ExpectedStatus, actual: FindingStatus): Outcome {
  if (actual === FINDING_STATUS.ERROR) return OUTCOME.ERROR;
  if (isPositive(expected)) return isPositive(actual) ? OUTCOME.CAUGHT : OUTCOME.MISS;
  return isPositive(actual) ? OUTCOME.FALSE_POSITIVE : OUTCOME.CORRECT_NEGATIVE;
}

function findingFor(run: DocumentRun, ruleId: RuleId): Finding {
  const finding = run.result.findings.find((f) => f.ruleId === ruleId);
  if (!finding) throw new Error(`${run.document.name}: no Finding for ${ruleId}.`);
  return finding;
}

/** Expected vs actual Status per Rule, in Playbook order. */
export function compareDocument(run: DocumentRun): RuleComparison[] {
  return PLAYBOOK.map((rule) => {
    const expected = run.document.labels[rule.id].expected;
    const actual = findingFor(run, rule.id).status;
    return { ruleId: rule.id, expected, actual, outcome: outcomeOf(expected, actual), exact: expected === actual };
  });
}

export function sumPassUsage(usage: PassUsage): TokenUsage {
  return MODEL_PASSES.reduce((sum, pass) => addUsage(sum, usage[pass]), ZERO_USAGE);
}

const addPassUsage = (a: PassUsage, b: PassUsage): PassUsage =>
  Object.fromEntries(MODEL_PASSES.map((pass) => [pass, addUsage(a[pass], b[pass])])) as Record<ModelPass, TokenUsage>;

export function costUsd(usage: TokenUsage, pricing: ModelPricing | null): number | null {
  if (!pricing) return null;
  return (usage.input * pricing.inputPerMTok + usage.output * pricing.outputPerMTok) / 1_000_000;
}

const EMPTY_METRICS: RuleMetrics = {
  recall: ZERO_RATIO,
  precision: ZERO_RATIO,
  exact: ZERO_RATIO,
  errors: 0,
  citationsFirstTry: ZERO_RATIO,
  citationsFinal: ZERO_RATIO,
  usage: ZERO_PASS_USAGE,
};

function addMetrics(a: RuleMetrics, b: RuleMetrics): RuleMetrics {
  return {
    recall: addRatio(a.recall, b.recall),
    precision: addRatio(a.precision, b.precision),
    exact: addRatio(a.exact, b.exact),
    errors: a.errors + b.errors,
    citationsFirstTry: addRatio(a.citationsFirstTry, b.citationsFirstTry),
    citationsFinal: addRatio(a.citationsFinal, b.citationsFinal),
    usage: addPassUsage(a.usage, b.usage),
  };
}

/** One Rule on one Document, as metrics that sum across Documents. */
function scoreRule(run: DocumentRun, ruleId: RuleId): RuleMetrics {
  const finding = findingFor(run, ruleId);
  const expected = run.document.labels[ruleId].expected;
  const outcome = outcomeOf(expected, finding.status);
  const flagged = isPositive(finding.status);
  const ruleRun = run.result.usage.rules.find((r) => r.ruleId === ruleId);
  const firstPass = ruleRun?.firstPassCitations;

  return {
    recall: { hit: outcome === OUTCOME.CAUGHT ? 1 : 0, total: isPositive(expected) ? 1 : 0 },
    precision: { hit: flagged && isPositive(expected) ? 1 : 0, total: flagged ? 1 : 0 },
    exact: { hit: expected === finding.status ? 1 : 0, total: 1 },
    errors: finding.status === FINDING_STATUS.ERROR ? 1 : 0,
    citationsFirstTry: firstPass ? { hit: firstPass.verified, total: firstPass.proposed } : ZERO_RATIO,
    citationsFinal: {
      hit: finding.citations.length,
      total: finding.citations.length + finding.blockedCitations.length,
    },
    usage: ruleRun?.usage ?? ZERO_PASS_USAGE,
  };
}

export function documentUsage(result: ReviewResult): TokenUsage {
  return result.usage.rules.reduce((sum, rule) => addUsage(sum, sumPassUsage(rule.usage)), result.usage.mapClauses);
}

export function summarize(runs: readonly DocumentRun[], pricing: ModelPricing | null): EvalSummary {
  const rules = Object.fromEntries(
    PLAYBOOK.map((rule) => [rule.id, runs.reduce((sum, run) => addMetrics(sum, scoreRule(run, rule.id)), EMPTY_METRICS)]),
  ) as Record<RuleId, RuleMetrics>;
  const total = PLAYBOOK.reduce((sum, rule) => addMetrics(sum, rules[rule.id]), EMPTY_METRICS);

  const documents = runs.map((run) => {
    const usage = documentUsage(run.result);
    return { name: run.document.name, usage, costUsd: costUsd(usage, pricing) };
  });
  const totalCostUsd = documents.reduce<number | null>(
    (sum, doc) => (sum === null || doc.costUsd === null ? null : sum + doc.costUsd),
    0,
  );

  return {
    rules,
    total,
    mapClauses: runs.reduce((sum, run) => addUsage(sum, run.result.usage.mapClauses), ZERO_USAGE),
    documents,
    totalCostUsd,
  };
}
