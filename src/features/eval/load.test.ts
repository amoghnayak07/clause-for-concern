import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLabeledDocuments } from "./load";
import { SAMPLE_NDA, sampleLabelFile } from "./testing";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "eval-load-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function addDocument(base: string, labels: unknown = sampleLabelFile(`${base}.txt`), text = SAMPLE_NDA) {
  await writeFile(path.join(dir, `${base}.txt`), text, "utf8");
  const raw = typeof labels === "string" ? labels : JSON.stringify(labels);
  await writeFile(path.join(dir, `${base}.labels.json`), raw, "utf8");
}

describe("loadLabeledDocuments", () => {
  it("loads every document in name order, stripping a BOM", async () => {
    await addDocument("02-b");
    await addDocument("01-a", undefined, `﻿${SAMPLE_NDA}`);

    const result = await loadLabeledDocuments(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documents.map((d) => d.name)).toEqual(["01-a.txt", "02-b.txt"]);
      expect(result.documents[0].text).toBe(SAMPLE_NDA);
    }
  });

  it("filters by file-name prefix", async () => {
    await addDocument("01-a");
    await addDocument("02-b");
    const result = await loadLabeledDocuments(dir, ["02"]);
    expect(result.ok && result.documents.map((d) => d.name)).toEqual(["02-b.txt"]);
  });

  it("collects problems across every document before failing", async () => {
    const bad = sampleLabelFile("01-a.txt");
    await addDocument("01-a", { ...bad, labels: { ...bad.labels, MUTUAL: { expected: "COMPLIANT", anchor: null } } });
    await addDocument("02-b", "{ not json");
    await writeFile(path.join(dir, "03-c.txt"), SAMPLE_NDA, "utf8");
    await writeFile(path.join(dir, "04-orphan.labels.json"), "{}", "utf8");

    const result = await loadLabeledDocuments(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toEqual([
        expect.stringMatching(/^04-orphan\.labels\.json: no matching/),
        expect.stringMatching(/^01-a\.labels\.json: labels\.MUTUAL: anchor is required/),
        expect.stringMatching(/^02-b\.labels\.json: invalid JSON/),
        expect.stringMatching(/^03-c\.labels\.json: missing/),
      ]);
    }
  });

  it("fails clearly when there is nothing to evaluate", async () => {
    expect(await loadLabeledDocuments(dir)).toEqual({ ok: false, problems: [expect.stringContaining("No *.txt documents")] });
    expect(await loadLabeledDocuments(path.join(dir, "missing"))).toEqual({
      ok: false,
      problems: [expect.stringContaining("Data directory not found")],
    });
  });
});
