import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { EVAL_DOCUMENT_SUFFIX, EVAL_LABELS_SUFFIX } from "@/common/constants";
import { validateLabels, type LabeledDocument } from "./labels";

/**
 * Reads `data/*.txt` with their label files and validates every one before
 * any model call. Problems are collected across all Documents so one run
 * reports everything that needs fixing.
 */

export type LoadResult =
  | { readonly ok: true; readonly documents: readonly LabeledDocument[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Strips a UTF-8 byte-order mark, which editors on Windows like to add. */
const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * @param filters Optional file-name prefixes (e.g. `["02", "04"]`); empty means every Document.
 */
export async function loadLabeledDocuments(dir: string, filters: readonly string[] = []): Promise<LoadResult> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { ok: false, problems: [`Data directory not found: ${dir}`] };
  }

  const all = entries.filter((name) => name.endsWith(EVAL_DOCUMENT_SUFFIX)).sort();
  const selected = filters.length === 0 ? all : all.filter((name) => filters.some((f) => name.startsWith(f)));
  if (selected.length === 0) {
    const scope = filters.length === 0 ? "" : ` matching ${filters.join(", ")}`;
    return { ok: false, problems: [`No *${EVAL_DOCUMENT_SUFFIX} documents${scope} in ${dir} (see data/README.md).`] };
  }

  const problems: string[] = [];
  if (filters.length === 0) {
    const documentBases = new Set(all.map((name) => name.slice(0, -EVAL_DOCUMENT_SUFFIX.length)));
    for (const name of entries.filter((n) => n.endsWith(EVAL_LABELS_SUFFIX))) {
      if (!documentBases.has(name.slice(0, -EVAL_LABELS_SUFFIX.length))) {
        problems.push(`${name}: no matching ${EVAL_DOCUMENT_SUFFIX} document`);
      }
    }
  }

  const documents: LabeledDocument[] = [];
  for (const name of selected) {
    const labelsName = name.slice(0, -EVAL_DOCUMENT_SUFFIX.length) + EVAL_LABELS_SUFFIX;
    const text = stripBom(await readFile(path.join(dir, name), "utf8"));

    let raw: string;
    try {
      raw = await readFile(path.join(dir, labelsName), "utf8");
    } catch {
      problems.push(`${labelsName}: missing (every document needs a label file)`);
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(stripBom(raw));
    } catch (error) {
      problems.push(`${labelsName}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }

    const validation = validateLabels(name, text, json);
    if (validation.ok) documents.push(validation.document);
    else problems.push(...validation.problems.map((problem) => `${labelsName}: ${problem}`));
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, documents };
}
