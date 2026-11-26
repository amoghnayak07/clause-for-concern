"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { PLAYBOOK, REVIEW_PHASE, REVIEW_UI_TEXT } from "@/common/constants";
import { hasDocument } from "@/features/review/session";
import { ReviewInput } from "./ReviewInput";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { useReviewSession } from "./useReviewSession";

/** Paste → stream → workspace. Findings appear as each Rule finishes. */
export function ReviewApp() {
  const { session, start, cancel, reset } = useReviewSession();
  const running = session.phase === REVIEW_PHASE.RUNNING;

  if (session.phase === REVIEW_PHASE.IDLE || (session.phase === REVIEW_PHASE.FAILED && !hasDocument(session))) {
    return <ReviewInput initialText={session.text} error={session.error} onSubmit={start} />;
  }

  if (!hasDocument(session)) {
    return (
      <Stack direction="row" spacing={2} sx={{ p: 2, alignItems: "center" }}>
        <CircularProgress size={20} />
        <Typography>{REVIEW_UI_TEXT.SEGMENTING}</Typography>
        <Button onClick={cancel}>{REVIEW_UI_TEXT.CANCEL}</Button>
      </Stack>
    );
  }

  const progress = `${session.findings.length} of ${PLAYBOOK.length} rules`;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Stack spacing={1} sx={{ px: 2, pt: 1 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="body2" color="text.secondary" role="status" aria-live="polite">
            {running ? REVIEW_UI_TEXT.RUNNING : session.phase === REVIEW_PHASE.DONE ? REVIEW_UI_TEXT.DONE : null}
            {session.phase !== REVIEW_PHASE.FAILED && ` · ${progress}`}
          </Typography>
          <Button size="small" onClick={running ? cancel : reset}>
            {running ? REVIEW_UI_TEXT.CANCEL : REVIEW_UI_TEXT.NEW_REVIEW}
          </Button>
        </Stack>
        {running && (
          <LinearProgress variant="determinate" value={(session.findings.length / PLAYBOOK.length) * 100} />
        )}
        {session.error && <Alert severity="error">{session.error}</Alert>}
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ReviewWorkspace
          text={session.text}
          clauses={session.clauses}
          findings={session.findings}
          coverage={session.coverage}
          phase={session.phase}
        />
      </Box>
    </Box>
  );
}
