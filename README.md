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
