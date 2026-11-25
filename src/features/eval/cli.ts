import { config as loadEnv } from "dotenv";
import path from "node:path";
import { EVAL_DATA_DIR, MODEL_PRICING } from "@/common/constants";
import { ConfigError, getConfig } from "@/config";
import { createModelClient } from "@/features/agent/client";
import { runReview, type ReviewRunContext } from "@/features/agent/graph";
import { loadLabeledDocuments } from "./load";
import { summarize, type DocumentRun } from "./metrics";
import { formatDocumentRun, formatSummary } from "./report";

/**
 * Eval CLI (DESIGN "Eval CLI"): `npm run eval [-- <file-prefix>...]`.
 *
 * Loads the same `.env` through the config module, validates every label
 * file, then runs the same compiled graph as the app over each Document, one
 * at a time. Ctrl+C cancels the in-flight review.
 */

const EXIT = { OK: 0, FAILED: 1, CANCELLED: 130 } as const;

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === "AbortError");
}

async function main(args: readonly string[]): Promise<number> {
  loadEnv({ quiet: true });
  let config;
  try {
    config = getConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return EXIT.FAILED;
    }
    throw error;
  }

  const dataDir = path.resolve(EVAL_DATA_DIR);
  const loaded = await loadLabeledDocuments(dataDir, args);
  if (!loaded.ok) {
    console.error(`Label validation failed; nothing was sent to the model.\n`);
    for (const problem of loaded.problems) console.error(`  - ${problem}`);
    return EXIT.FAILED;
  }

  const model = config.reviewModel;
  const pricing = MODEL_PRICING[model] ?? null;
  if (!pricing) console.warn(`Note: ${model} has no entry in MODEL_PRICING; cost will be reported as n/a.\n`);

  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.error("\nCancelling... (Ctrl+C again to force quit)");
    controller.abort();
    process.once("SIGINT", () => process.exit(EXIT.CANCELLED));
  });

  const context: ReviewRunContext = { client: createModelClient(config), model };
  const runs: DocumentRun[] = [];
  const failed: string[] = [];

  console.log(`Evaluating ${loaded.documents.length} document(s) with ${model}.\n`);
  for (const document of loaded.documents) {
    const started = Date.now();
    try {
      const result = await runReview(document.text, context, controller.signal);
      const run = { document, result };
      runs.push(run);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${formatDocumentRun(run, pricing)}\n  (${seconds}s)\n`);
    } catch (error) {
      if (isCancellation(error, controller.signal)) {
        console.error("Eval cancelled.");
        return EXIT.CANCELLED;
      }
      failed.push(document.name);
      console.error(`${document.name}: review failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  if (runs.length > 0) console.log(formatSummary(summarize(runs, pricing), model, pricing));
  if (failed.length > 0) {
    console.error(`\n${failed.length} document(s) failed and are excluded from the metrics: ${failed.join(", ")}`);
    return EXIT.FAILED;
  }
  return EXIT.OK;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = EXIT.FAILED;
  },
);
