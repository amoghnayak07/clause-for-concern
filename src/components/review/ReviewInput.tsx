"use client";

import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import {
  INJECTION_TEXT,
  MAX_DOCUMENT_CHARS,
  NDA_CHECK_TEXT,
  REVIEW_UI_TEXT,
  UI_NUMBER_LOCALE,
  UPLOAD_ACCEPT,
  UPLOAD_UI_TEXT,
} from "@/common/constants";
import { detectInjection } from "@/features/document/injection";
import { ndaWarnings } from "@/features/document/ndaCheck";
import { readUploadedDocument, type DocxTextExtractor } from "@/features/document/upload";
import { DEMO_TEXT } from "@/features/viewer/fixture";

export interface ReviewInputProps {
  initialText: string;
  /** Shown above the input, e.g. a request the route rejected. */
  error: string | null;
  onSubmit: (text: string) => void;
}

const INPUT_ROWS = 18;
const formatCount = new Intl.NumberFormat(UI_NUMBER_LOCALE).format;

/** mammoth's browser build, loaded only when a `.docx` is picked so it stays out of the page bundle. */
const extractDocxInBrowser: DocxTextExtractor = async (arrayBuffer) => {
  const { extractRawText } = await import("mammoth");
  return (await extractRawText({ arrayBuffer })).value;
};

/**
 * Paste box for the Document, with `.docx` / `.txt` upload filling the same
 * box. The text is sent untouched so offsets match.
 */
export function ReviewInput({ initialText, error, onSubmit }: ReviewInputProps) {
  const [text, setText] = useState(initialText);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const tooLong = text.length > MAX_DOCUMENT_CHARS;
  const canSubmit = text.trim() !== "" && !tooLong && !uploading;
  // The text the "not an NDA" warning was shown for; submitting it again goes ahead.
  const [warnedText, setWarnedText] = useState<string | null>(null);
  const warnings = warnedText === text ? ndaWarnings(text) : [];
  // The text a prompt injection was found in; Review stays off until it changes.
  const [blockedText, setBlockedText] = useState<string | null>(null);
  const injections = useMemo(() => (blockedText === text ? detectInjection(text) : []), [blockedText, text]);
  const blocked = injections.length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit || blocked) return;
    if (detectInjection(text).length > 0) {
      setBlockedText(text);
      return;
    }
    if (warnedText !== text && ndaWarnings(text).length > 0) {
      setWarnedText(text);
      return;
    }
    onSubmit(text);
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Clear so picking the same file again still fires `change`.
    input.value = "";
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    const result = await readUploadedDocument(file, extractDocxInBrowser);
    setUploading(false);
    if (result.ok) setText(result.text);
    else setUploadError(result.error);
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ p: 2, maxWidth: 960 }}>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {uploadError && (
          <Alert severity="warning" onClose={() => setUploadError(null)}>
            {uploadError}
          </Alert>
        )}
        {blocked && (
          <Alert severity="error" role="alert">
            <AlertTitle>{INJECTION_TEXT.TITLE}</AlertTitle>
            {INJECTION_TEXT.BODY} {INJECTION_TEXT.ACTION}
            <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }}>
              {injections.map((match) => (
                <li key={`${match.patternId}:${match.start}`}>
                  {match.label}:{" "}
                  <Box component="q" sx={{ fontFamily: "monospace" }}>
                    {match.excerpt}
                  </Box>
                </li>
              ))}
            </Box>
          </Alert>
        )}
        {warnings.length > 0 && (
          <Alert severity="warning">
            <AlertTitle>{NDA_CHECK_TEXT.TITLE}</AlertTitle>
            {warnings.map((warning) => NDA_CHECK_TEXT[warning]).join(" ")} {NDA_CHECK_TEXT.ADVICE}
          </Alert>
        )}
        <TextField
          label={REVIEW_UI_TEXT.INPUT_LABEL}
          placeholder={REVIEW_UI_TEXT.INPUT_PLACEHOLDER}
          value={text}
          onChange={(event) => setText(event.target.value)}
          multiline
          minRows={INPUT_ROWS}
          maxRows={INPUT_ROWS}
          fullWidth
          autoFocus
          disabled={uploading}
          error={tooLong}
          helperText={`${tooLong ? `${REVIEW_UI_TEXT.TOO_LONG} ` : ""}${formatCount(text.length)} / ${formatCount(MAX_DOCUMENT_CHARS)}`}
          slotProps={{ htmlInput: { spellCheck: false, sx: { fontFamily: "monospace" } } }}
        />
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={!canSubmit || blocked}>
            {warnings.length > 0 ? NDA_CHECK_TEXT.REVIEW_ANYWAY : REVIEW_UI_TEXT.SUBMIT}
          </Button>
          <Button component="label" variant="outlined" disabled={uploading}>
            {uploading ? UPLOAD_UI_TEXT.READING : UPLOAD_UI_TEXT.BUTTON}
            <input type="file" accept={UPLOAD_ACCEPT} hidden onChange={upload} />
          </Button>
          <Button onClick={() => setText(DEMO_TEXT)} disabled={uploading}>
            {REVIEW_UI_TEXT.LOAD_SAMPLE}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
