# Per-rule fan-out, with LangGraph as orchestrator only

Each Rule is checked by its own subgraph (detect → verify citations → verify finding), fanned out with LangGraph's Send API, rather than one model call checking all Rules. Focused single-rule prompts serve recall (our top goal), a failure in one Rule becomes an ERROR Finding for that Rule only, and results line up one-to-one with the per-rule eval. The cost is roughly one model call per Rule per pass instead of one total, which we accept.

LangGraph only orchestrates: nodes call the Anthropic SDK directly and validate with our own Zod schemas, so prompts, verification and agent logic are plain functions that don't import the framework and can be unit-tested and reused by the eval script. The UI route and the eval CLI run the same compiled graph.

## Consequences

- Subgraphs catch their own errors and emit an ERROR Finding instead of throwing, so the parent run always completes.
- Checkpointing is in-memory only. In production each Rule check would be a durable, retryable step; that is out of scope here.
