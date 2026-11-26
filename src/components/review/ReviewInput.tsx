"use client";

import { useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { MAX_DOCUMENT_CHARS, REVIEW_UI_TEXT, UI_NUMBER_LOCALE } from "@/common/constants";
import { DEMO_TEXT } from "@/features/viewer/fixture";

export interface ReviewInputProps {
  initialText: string;
  /** Shown above the input, e.g. a request the route rejected. */
  error: string | null;
  onSubmit: (text: string) => void;
}

const INPUT_ROWS = 18;
const formatCount = new Intl.NumberFormat(UI_NUMBER_LOCALE).format;

/** Paste box for the Document. The text is sent untouched so offsets match. */
export function ReviewInput({ initialText, error, onSubmit }: ReviewInputProps) {
  const [text, setText] = useState(initialText);
  const tooLong = text.length > MAX_DOCUMENT_CHARS;
  const canSubmit = text.trim() !== "" && !tooLong;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) onSubmit(text);
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ p: 2, maxWidth: 960 }}>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
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
          error={tooLong}
          helperText={`${tooLong ? `${REVIEW_UI_TEXT.TOO_LONG} ` : ""}${formatCount(text.length)} / ${formatCount(MAX_DOCUMENT_CHARS)}`}
          slotProps={{ htmlInput: { spellCheck: false, sx: { fontFamily: "monospace" } } }}
        />
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={!canSubmit}>
            {REVIEW_UI_TEXT.SUBMIT}
          </Button>
          <Button onClick={() => setText(DEMO_TEXT)}>{REVIEW_UI_TEXT.LOAD_SAMPLE}</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
