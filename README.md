# Clause for Concern

An NDA review tool. Paste or upload an NDA; an agent checks it against a fixed playbook and produces findings with **verified citations**; a reviewer clears them in a keyboard-driven triage queue.

> Work in progress. See `docs/DESIGN.md` for the agreed design, `GLOSSARY.md` for vocabulary and `docs/adr/` for key decisions.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY and REVIEW_MODEL (e.g. claude-opus-5-5)
npm run dev
```

The server validates `.env` on startup and exits with a clear message if a key is missing.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run lint` | ESLint |
| `npm run eval [-- 02 04]` | Eval CLI over `data/*.txt` (optionally only files starting with the given prefixes): validates every label file first, then prints per-rule recall/precision, citation pass rates, tokens and cost. Calls the model; needs `.env`. Data spec: `data/README.md` |

## Layout

```
src/
  app/                 Next.js routes and route handlers (thin)
  common/constants.ts  every fixed value: playbook, statuses, colours, shortcuts, retries, limits
  config/              env validation (Zod); the only reader of process.env
  theme/               MUI theme (reads colours from constants)
  components/common/   shared UI (status chip, citation highlight, keyboard hint, ...)
  features/
    document/          segmentation, viewer, minimap
    citations/         quote verification
    agent/             prompts, schemas, detector, verifier, graph
    review/            queue, finding card, keyboard triage
    eval/              CLI eval over data/
```

Business logic lives outside React so the eval CLI and tests can reuse it.

## Reviewing

Work through the queue with the keyboard: **K** next, **J** previous, **A** approve, **E** edit the redline, **X** escalate (reason required), **D** dismiss. When the review finishes, export from the queue panel:

- **Download revised NDA**: the document as plain text, with every approved or edited redline applied. Escalated, dismissed and undecided findings change nothing.
- **Download review summary**: Markdown listing escalations with their reasons, then every finding's status, decision and whether its redline was applied.

Decisions live only in the browser tab; reloading or starting a new review discards them.

## What I would do next

- **Re-review after decisions**: re-run a single rule on a dismissed or edited finding (or over the revised document) instead of the whole review.
- **Reviewer corrections → eval cases**: turn edits and dismissals into labelled data for the eval CLI.
- **Persist decisions**: auth and a database so a review survives a reload, plus durable per-rule steps and multi-document matters.
- **`.docx` export**: write redlines back as tracked changes in the uploaded file instead of plain text.
- **Precision/recall sensitivity slider**.
- **Prompt caching** with cache warming.
- **One-click "check this clause"** for Unmapped Clauses.
