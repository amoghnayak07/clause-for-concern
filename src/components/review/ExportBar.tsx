"use client";

import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { EXPORT_FILES, EXPORT_TEXT } from "@/common/constants";
import type { Clause } from "@/features/document/types";
import { acceptedRedlines, reviewSummary, reviseDocument } from "@/features/review/export";
import type { Finding } from "@/features/review/finding";
import type { QueueState } from "@/features/review/queue";

export interface ExportBarProps {
  text: string;
  clauses: readonly Clause[];
  /** In queue order. */
  findings: readonly Finding[];
  decisions: QueueState["decisions"];
  /** Off while the review is still streaming. */
  disabled: boolean;
}

/** Downloads the Revised Document and the Review Summary, built on click from the current Decisions. */
export function ExportBar({ text, clauses, findings, decisions, disabled }: ExportBarProps) {
  const revise = () => reviseDocument(text, clauses, acceptedRedlines(findings, decisions));
  const undecided = findings.some((finding) => !decisions[finding.ruleId]);

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", mb: 1.5 }} useFlexGap>
      <Button
        size="small"
        variant="outlined"
        disabled={disabled}
        onClick={() => download(EXPORT_FILES.REVISED, revise().text)}
      >
        {EXPORT_TEXT.DOWNLOAD_REVISED}
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={disabled}
        onClick={() => download(EXPORT_FILES.SUMMARY, reviewSummary(findings, clauses, text, decisions, revise()))}
      >
        {EXPORT_TEXT.DOWNLOAD_SUMMARY}
      </Button>
      {!disabled && undecided && (
        <Typography variant="caption" color="text.secondary">
          {EXPORT_TEXT.UNDECIDED_WARNING}
        </Typography>
      )}
    </Stack>
  );
}

function download(file: { readonly NAME: string; readonly TYPE: string }, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: file.TYPE }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.NAME;
  link.click();
  // Revoke after the click's navigation has picked up the URL (Firefox needs the tick).
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
