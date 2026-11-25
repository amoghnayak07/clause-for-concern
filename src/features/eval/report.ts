import { PLAYBOOK, type ModelPricing } from "@/common/constants";
import { addUsage, ZERO_USAGE, type TokenUsage } from "@/features/agent/callModel";
import { MODEL_PASS } from "@/features/agent/state";
import type { Coverage } from "@/features/review/coverage";
import {
  compareDocument,
  costUsd,
  documentUsage,
  OUTCOME,
  rate,
  type DocumentRun,
  type EvalSummary,
  type Outcome,
  type Ratio,
  type RuleMetrics,
} from "./metrics";

/** Plain-text report for the eval CLI. Formatting only; every number comes from `metrics`. */

type Align = "left" | "right";

/** Fixed-width table: the first column is left-aligned, the rest right-aligned unless given. */
export function table(header: readonly string[], rows: readonly (readonly string[])[], align?: readonly Align[]): string {
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map((row) => (row[i] ?? "").length)));
  const alignOf = (i: number): Align => align?.[i] ?? (i === 0 ? "left" : "right");
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, i) => (alignOf(i) === "left" ? cell.padEnd(widths[i]) : cell.padStart(widths[i])))
      .join("  ")
      .trimEnd();
  const rule = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(header), rule, ...rows.map(line)].join("\n");
}

export function formatRatio(ratio: Ratio): string {
  const value = rate(ratio);
  if (value === null) return "-";
  return `${Math.round(value * 100)}% (${ratio.hit}/${ratio.total})`;
}

export function formatUsd(value: number | null): string {
  return value === null ? "n/a" : `$${value.toFixed(4)}`;
}

const formatInt = (value: number) => value.toLocaleString("en-US");

function formatCoverage(coverage: Coverage): string {
  return coverage.available ? `${coverage.covered}/${coverage.total} clauses mapped` : "coverage unavailable";
}

const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = {
  [OUTCOME.CAUGHT]: "caught",
  [OUTCOME.MISS]: "MISS",
  [OUTCOME.FALSE_POSITIVE]: "FALSE POSITIVE",
  [OUTCOME.CORRECT_NEGATIVE]: "ok",
  [OUTCOME.ERROR]: "ERROR (miss)",
};

/** One Document's result, printed as soon as it finishes. */
export function formatDocumentRun(run: DocumentRun, pricing: ModelPricing | null): string {
  const { result } = run;
  const cost = costUsd(documentUsage(result), pricing);
  const heading = `${run.document.name}  (${formatCoverage(result.coverage)}, ${formatUsd(cost)})`;
  const rows = compareDocument(run).map((c) => {
    const finding = result.findings.find((f) => f.ruleId === c.ruleId);
    const detail = finding?.error ? `${finding.error.kind}: ${finding.error.message}` : "";
    return [c.ruleId, c.expected, c.actual, c.exact ? "" : "≠", OUTCOME_LABEL[c.outcome], detail];
  });
  const body = table(["Rule", "Expected", "Actual", "", "Outcome", "Error"], rows, [
    "left",
    "left",
    "left",
    "left",
    "left",
    "left",
  ]);
  return `${heading}\n${indent(body)}`;
}

function metricsRow(name: string, metrics: RuleMetrics): string[] {
  return [
    name,
    formatRatio(metrics.recall),
    String(metrics.errors),
    formatRatio(metrics.precision),
    formatRatio(metrics.exact),
    formatRatio(metrics.citationsFirstTry),
    formatRatio(metrics.citationsFinal),
  ];
}

function usageCells(usage: TokenUsage): string[] {
  return [formatInt(usage.input), formatInt(usage.output), formatInt(usage.thinking)];
}

export function formatSummary(summary: EvalSummary, model: string, pricing: ModelPricing | null): string {
  const quality = table(
    ["Rule", "Recall", "Errors", "Precision", "Exact status", "Citations 1st try", "Citations final"],
    [...PLAYBOOK.map((rule) => metricsRow(rule.id, summary.rules[rule.id])), metricsRow("ALL", summary.total)],
  );

  const tokenRows: string[][] = [];
  for (const rule of PLAYBOOK) {
    const usage = summary.rules[rule.id].usage;
    for (const pass of Object.values(MODEL_PASS)) tokenRows.push([rule.id, pass, ...usageCells(usage[pass])]);
  }
  tokenRows.push(["(mapClauses)", "MAP", ...usageCells(summary.mapClauses)]);
  const allTokens = summary.documents.reduce((sum, doc) => addUsage(sum, doc.usage), ZERO_USAGE);
  tokenRows.push(["ALL", "", ...usageCells(allTokens)]);
  const tokens = table(["Rule", "Pass", "Input", "Output (incl. thinking)", "Thinking"], tokenRows, [
    "left",
    "left",
  ]);

  const costRows = summary.documents.map((doc) => [doc.name, ...usageCells(doc.usage), formatUsd(doc.costUsd)]);
  costRows.push(["ALL", ...usageCells(allTokens), formatUsd(summary.totalCostUsd)]);
  const cost = table(["Document", "Input", "Output", "Thinking", "Cost"], costRows);

  const priceNote = pricing
    ? `${model} at $${pricing.inputPerMTok}/MTok input, $${pricing.outputPerMTok}/MTok output`
    : `${model} has no entry in MODEL_PRICING; cost not estimated`;

  return [
    "Quality (recall: Positive caught = not COMPLIANT; ERROR counts as a miss)",
    indent(quality),
    "",
    "Tokens per rule and pass",
    indent(tokens),
    "",
    `Cost per document (${priceNote})`,
    indent(cost),
  ].join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
