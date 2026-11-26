import { MAX_UPLOAD_BYTES, UPLOAD_EXTENSIONS, UPLOAD_KIND, UPLOAD_UI_TEXT, type UploadKind } from "@/common/constants";

/**
 * Reading an uploaded `.docx` or `.txt` into Document text. The result goes
 * into the input box, so the reviewer sees (and can edit) exactly what will
 * be sent; from there it follows the same path as pasted text.
 */

/** The parts of a browser `File` this module needs; Node tests pass a plain object. */
export interface UploadFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Raw text of a `.docx` (mammoth `extractRawText`). Injected: mammoth takes different inputs in the browser and Node. */
export type DocxTextExtractor = (data: ArrayBuffer) => Promise<string>;

export type UploadResult = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

/** Kind of an uploaded file by its extension (case-insensitive), or `null` if unsupported. */
export function uploadKind(fileName: string): UploadKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  return UPLOAD_EXTENSIONS[fileName.slice(dot).toLowerCase()] ?? null;
}

/**
 * Tidies extracted text before it becomes the Document: CRLF/CR → LF,
 * trailing whitespace on each line removed, runs of blank lines collapsed to
 * one (mammoth emits one blank line per paragraph, more for empty
 * paragraphs), and leading/trailing blank space trimmed. Leading indentation
 * is kept. Blank-line paragraphs are what the Clause splitter uses for
 * unnumbered text, so one blank line between paragraphs is preserved.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .trimEnd();
}

/** Reads an uploaded file into normalized Document text, or a user-facing error. Never throws. */
export async function readUploadedDocument(file: UploadFile, extractDocx: DocxTextExtractor): Promise<UploadResult> {
  const kind = uploadKind(file.name);
  if (kind === null) return { ok: false, error: UPLOAD_UI_TEXT.UNSUPPORTED };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: UPLOAD_UI_TEXT.TOO_LARGE };

  let raw: string;
  try {
    const data = await file.arrayBuffer();
    raw = kind === UPLOAD_KIND.DOCX ? await extractDocx(data) : new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return { ok: false, error: UPLOAD_UI_TEXT.FAILED };
  }

  const text = normalizeExtractedText(raw);
  // Length over MAX_DOCUMENT_CHARS is not rejected here: the input shows the
  // count and blocks submit, so the reviewer can trim the text instead.
  return text.trim() === "" ? { ok: false, error: UPLOAD_UI_TEXT.EMPTY } : { ok: true, text };
}
