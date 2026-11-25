# Model text is never shown as contract text

To guarantee zero hallucinated citations, every piece of contract text the reviewer sees is sliced from the original Document by our code at verified offsets; the model only ever *points* at text (Clause ID + quote) and we prove the pointer before rendering. This is stricter than "verify the quote, then display the quote": even a verified model quote is not rendered, the original span is.

## Consequences

- Blocked Citations never display the model's quote, only "the agent cited §X but the quote didn't match" plus the real Clause text.
- Free-text model output (rationale, verifier notes) is scanned for quoted passages; any that don't verify against the Document are replaced with `[unverified quote removed]`, and the remaining text is visually labelled as the agent's reasoning, not contract text.
- A citation that fails verification is retried once, then shown as Citation Blocked rather than dropped, because dropping it would trade recall for precision.
