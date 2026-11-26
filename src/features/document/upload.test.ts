import { readFileSync } from "node:fs";
import { extractRawText } from "mammoth";
import { describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_CHARS, MAX_UPLOAD_BYTES, UPLOAD_KIND, UPLOAD_UI_TEXT } from "@/common/constants";
import { segmentDocument } from "./segment";
import { normalizeExtractedText, readUploadedDocument, uploadKind, type DocxTextExtractor, type UploadFile } from "./upload";

/** Node build of mammoth takes a Buffer; the browser build takes `{ arrayBuffer }`. */
const nodeExtractor: DocxTextExtractor = async (data) => (await extractRawText({ buffer: Buffer.from(data) })).value;

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
}

function uploadFile(name: string, bytes: Uint8Array | string, size?: number): UploadFile {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return {
    name,
    size: size ?? data.byteLength,
    arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  };
}

describe("uploadKind", () => {
  it.each([
    ["nda.docx", UPLOAD_KIND.DOCX],
    ["NDA.DOCX", UPLOAD_KIND.DOCX],
    ["my.nda.v2.docx", UPLOAD_KIND.DOCX],
    ["nda.txt", UPLOAD_KIND.TXT],
    ["nda.Txt", UPLOAD_KIND.TXT],
  ])("accepts %s", (name, kind) => {
    expect(uploadKind(name)).toBe(kind);
  });

  it.each(["nda.doc", "nda.pdf", "nda", "docx", "nda.docx.exe", ".docx.bak"])("rejects %s", (name) => {
    expect(uploadKind(name)).toBeNull();
  });
});

describe("normalizeExtractedText", () => {
  it("converts CRLF and lone CR line endings to LF", () => {
    expect(normalizeExtractedText("a\r\nb\rc\n")).toBe("a\nb\nc");
  });

  it("collapses runs of blank lines to a single blank line", () => {
    expect(normalizeExtractedText("Title\n\n\n\n\n1. First.\n\n\n2. Second.")).toBe("Title\n\n1. First.\n\n2. Second.");
  });

  it("treats whitespace-only lines as blank and strips trailing whitespace", () => {
    expect(normalizeExtractedText("a  \t\n   \n\n\nb ")).toBe("a\n\nb");
  });

  it("keeps leading indentation and single line breaks", () => {
    expect(normalizeExtractedText("\n\n  (a) one\n  (b) two\n")).toBe("  (a) one\n  (b) two");
  });

  it("leaves already-normal text unchanged", () => {
    const text = "1. One.\n\n1.1 Sub.\n(a) Item.";
    expect(normalizeExtractedText(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = normalizeExtractedText("x\r\n\r\n\r\n y \n\n\n");
    expect(normalizeExtractedText(once)).toBe(once);
  });
});

describe("readUploadedDocument", () => {
  it("extracts and normalizes a .docx with mammoth", async () => {
    const result = await readUploadedDocument(uploadFile("nda.docx", fixture("sample.docx")), nodeExtractor);

    expect(result).toEqual({
      ok: true,
      text: [
        "MUTUAL NON-DISCLOSURE AGREEMENT",
        "",
        "1. Confidentiality.",
        "",
        "1.1 The Recipient shall keep the Discloser’s information confidential.",
        "",
        "(a) Information that is public is excluded.",
        "",
        "2. Governing Law. This Agreement is governed by the laws of Delaware.",
      ].join("\n"),
    });
  });

  it("produces text the Clause splitter numbers like pasted text", async () => {
    const result = await readUploadedDocument(uploadFile("nda.docx", fixture("sample.docx")), nodeExtractor);
    if (!result.ok) throw new Error(result.error);

    expect(segmentDocument(result.text).map((clause) => clause.label)).toEqual([
      expect.any(String),
      "§1",
      "§1.1",
      "§1.1(a)",
      "§2",
    ]);
  });

  it("reports a .docx with no text as empty", async () => {
    const result = await readUploadedDocument(uploadFile("blank.docx", fixture("empty.docx")), nodeExtractor);
    expect(result).toEqual({ ok: false, error: UPLOAD_UI_TEXT.EMPTY });
  });

  it("reports a corrupt .docx as unreadable", async () => {
    const result = await readUploadedDocument(uploadFile("broken.docx", "not a zip file"), nodeExtractor);
    expect(result).toEqual({ ok: false, error: UPLOAD_UI_TEXT.FAILED });
  });

  it("reads a UTF-8 .txt without mammoth and strips the BOM", async () => {
    const extract = vi.fn<DocxTextExtractor>();
    const result = await readUploadedDocument(uploadFile("nda.txt", "﻿1. One.\r\n\r\n\r\n2. Two’s.\r\n"), extract);

    expect(result).toEqual({ ok: true, text: "1. One.\n\n2. Two’s." });
    expect(extract).not.toHaveBeenCalled();
  });

  it("reports a .txt that isn't UTF-8 as unreadable", async () => {
    const result = await readUploadedDocument(uploadFile("nda.txt", new Uint8Array([0x31, 0x2e, 0xff, 0xfe])), nodeExtractor);
    expect(result).toEqual({ ok: false, error: UPLOAD_UI_TEXT.FAILED });
  });

  it("rejects unsupported file types before reading them", async () => {
    const file = uploadFile("nda.pdf", "%PDF-1.7");
    const read = vi.spyOn(file, "arrayBuffer");

    expect(await readUploadedDocument(file, nodeExtractor)).toEqual({ ok: false, error: UPLOAD_UI_TEXT.UNSUPPORTED });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects files over the byte limit before reading them", async () => {
    const file = uploadFile("huge.docx", "x", MAX_UPLOAD_BYTES + 1);
    const read = vi.spyOn(file, "arrayBuffer");

    expect(await readUploadedDocument(file, nodeExtractor)).toEqual({ ok: false, error: UPLOAD_UI_TEXT.TOO_LARGE });
    expect(read).not.toHaveBeenCalled();
  });

  it("loads text over the character limit so the input can flag it", async () => {
    const long = "x".repeat(MAX_DOCUMENT_CHARS + 1);
    const result = await readUploadedDocument(uploadFile("long.txt", long), nodeExtractor);
    expect(result).toEqual({ ok: true, text: long });
  });

  it("reports an extractor failure as unreadable", async () => {
    const failing: DocxTextExtractor = () => Promise.reject(new Error("boom"));
    const result = await readUploadedDocument(uploadFile("nda.docx", fixture("sample.docx")), failing);
    expect(result).toEqual({ ok: false, error: UPLOAD_UI_TEXT.FAILED });
  });
});
