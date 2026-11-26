"use client";

import type { KeyboardEvent } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { CITATION_HIGHLIGHT_ALPHA, DECISION_KIND, QUEUE_UI_TEXT } from "@/common/constants";
import { canSubmit, type QueueMode } from "@/features/review/queue";
import type { DiffPart } from "@/features/viewer/card";

export interface DecisionEditorProps {
  mode: Exclude<QueueMode, { kind: "browse" }>;
  /** Word diff of the Clause with the draft applied (edit mode only). */
  diff: readonly DiffPart[] | null;
  onDraft: (draft: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Inline Redline editor (E) or reason field (X, D) on the focused Finding card. */
export function DecisionEditor({ mode, diff, onDraft, onSubmit, onCancel }: DecisionEditorProps) {
  const editing = mode.kind === "edit";
  const label = editing
    ? QUEUE_UI_TEXT.EDIT_LABEL
    : mode.decision === DECISION_KIND.ESCALATE
      ? QUEUE_UI_TEXT.ESCALATE_LABEL
      : QUEUE_UI_TEXT.DISMISS_LABEL;

  const onKeyDown = (event: KeyboardEvent) => {
    // Keep keys inside the field away from the card and the queue shortcuts.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <Box sx={{ mt: 1.5 }} onClick={(event) => event.stopPropagation()}>
      <TextField
        autoFocus
        fullWidth
        multiline={editing}
        minRows={editing ? 2 : undefined}
        size="small"
        label={label}
        value={mode.draft}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={onKeyDown}
        helperText={editing ? QUEUE_UI_TEXT.EDIT_HELP : QUEUE_UI_TEXT.REASON_HELP}
        onFocus={(event) => {
          // Start with the caret at the end rather than selecting the text.
          const length = event.target.value.length;
          event.target.setSelectionRange(length, length);
        }}
      />
      {editing && diff && <WordDiff parts={diff} />}
      <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: "flex-end" }}>
        <Button size="small" onClick={onCancel}>
          {QUEUE_UI_TEXT.CANCEL}
        </Button>
        <Button size="small" variant="contained" disabled={!canSubmit(mode)} onClick={onSubmit}>
          {QUEUE_UI_TEXT.SAVE}
        </Button>
      </Stack>
    </Box>
  );
}

/** The Clause as it would read after the edit; text is from the Document plus the reviewer's draft. */
function WordDiff({ parts }: { parts: readonly DiffPart[] }) {
  const theme = useTheme();
  const added = theme.palette.review.action.NONE;
  const removed = theme.palette.review.action.ESCALATE;
  return (
    <Box component="section" aria-label={QUEUE_UI_TEXT.DIFF_LABEL} sx={{ mt: 1 }}>
      <Typography variant="caption" component="h4" color="text.secondary">
        {QUEUE_UI_TEXT.DIFF_LABEL}
      </Typography>
      <Typography variant="body2" component="p" sx={{ whiteSpace: "pre-wrap" }}>
        {parts.map((part, index) =>
          part.kind === "equal" ? (
            <span key={index}>{part.text}</span>
          ) : part.kind === "added" ? (
            <Box component="ins" key={index} sx={{ bgcolor: alpha(added, CITATION_HIGHLIGHT_ALPHA), textDecorationColor: added }}>
              {part.text}
            </Box>
          ) : (
            <Box component="del" key={index} sx={{ bgcolor: alpha(removed, CITATION_HIGHLIGHT_ALPHA), color: "text.secondary" }}>
              {part.text}
            </Box>
          ),
        )}
      </Typography>
    </Box>
  );
}
