# Eval data spec

Five plain-text NDAs plus one label file each. The eval script validates every label against its document before running, so a bad anchor fails loudly instead of skewing results.

## Files

```
data/
  01-clean-mutual.txt          01-clean-mutual.labels.json
  02-one-way-ny.txt            02-one-way-ny.labels.json
  03-silent-letter.txt         03-silent-letter.labels.json
  04-subtle-traps.txt          04-subtle-traps.labels.json
  05-keyword-decoys.txt        05-keyword-decoys.labels.json
```

- Plain UTF-8 `.txt`. Roughly 1,000–2,500 words each (real NDAs are 2–6 pages).
- Party names are fictional.

## Rule IDs

| ID | Kind | Compliant when |
|---|---|---|
| `MUTUAL` | REQUIRED | Both parties are bound as discloser *and* recipient, on symmetric terms |
| `GOVERNING_LAW` | REQUIRED | Governing law is Delaware or California (venue/forum ignored) |
| `CONFIDENTIALITY_TERM` | REQUIRED | Confidentiality obligations survive ≤ 2 years (an indefinite trade-secret carve-out is fine) |
| `NO_NON_SOLICIT` | PROHIBITED | No non-solicit / no-hire of employees, customers or suppliers, including "won't use CI to solicit" |
| `NO_RESIDUALS` | PROHIBITED | No right to use information retained in unaided memory |
| `CONFIDENTIALITY_CARVE_OUTS` | REQUIRED | All five present: public, already known, independently developed, received from third party, compelled by law (with notice) |

## Label matrix (what each document must contain)

`R` = RISK_FOUND, `C` = COMPLIANT, `N` = NOT_FOUND. Every rule has at least 2 positives (R or N).

| Doc | MUTUAL | GOVERNING_LAW | CONFIDENTIALITY_TERM | NO_NON_SOLICIT | NO_RESIDUALS | CONFIDENTIALITY_CARVE_OUTS |
|---|---|---|---|---|---|---|
| 01 clean mutual | C | C (Delaware) | C (2 years) | C | C | C (all five) |
| 02 one-way NY | R (one-way) | R (New York) | R (perpetual) | C | R (explicit residuals clause) | R (independent development missing) |
| 03 silent letter | C | N (no governing law at all) | N (no duration stated) | R (employee no-hire buried in a miscellaneous paragraph) | C | N (no carve-outs at all) |
| 04 subtle traps | R ("mutual" title, but only one party's obligations include a return/destroy and audit duty) | C (Delaware law, exclusive New York courts) | C (2 years; trade secrets as long as they remain trade secrets) | R (soft: "shall not use Confidential Information to solicit any employee") | R (residuals hidden inside a definitions sub-clause) | C (five carve-outs split across (a)–(e)) |
| 05 keyword decoys | C | C (California) | R (3 years) | C (word "solicit" appears harmlessly, e.g. "nothing herein solicits an offer") | C ("residual" appears harmlessly, e.g. "residual obligations survive termination") | R (compelled-disclosure carve-out missing) |

## Formatting variety (important: clean docs flatter the segmenter)

- **01**: conventional `1.` / `1.1` numbering, straight quotes.
- **02**: `ARTICLE I` / `Section 1.01` headings, curly quotes “ ” ’, em dashes.
- **03**: letter-style ("Dear Ms. …"), mostly unnumbered paragraphs, a signature block.
- **04**: deep nesting `1.` → `(a)` → `(i)`, a definitions section, a recitals block ("WHEREAS …").
- **05**: hard line breaks mid-sentence (as if copied from a PDF), mixed `Section 3` and `3.1`, a few double spaces.

## Label file format

```json
{
  "document": "02-one-way-ny.txt",
  "labels": {
    "MUTUAL":                     { "expected": "RISK_FOUND",  "anchor": "exact text from the document" },
    "GOVERNING_LAW":              { "expected": "RISK_FOUND",  "anchor": "..." },
    "CONFIDENTIALITY_TERM":       { "expected": "RISK_FOUND",  "anchor": "..." },
    "NO_NON_SOLICIT":             { "expected": "COMPLIANT",   "anchor": null },
    "NO_RESIDUALS":               { "expected": "RISK_FOUND",  "anchor": "..." },
    "CONFIDENTIALITY_CARVE_OUTS": { "expected": "RISK_FOUND",  "anchor": "..." }
  },
  "notes": "Free text: what the trap is and why the label is what it is."
}
```

- All six rule IDs are required in every label file.
- `anchor`: an exact substring of the document (20+ chars) pointing at the evidence. It is `null` exactly when no clause exists to point to (NOT_FOUND, or COMPLIANT for a PROHIBITED rule).
- For COMPLIANT on a REQUIRED rule, anchor the clause that proves compliance.

## Generating with AI: checklist

1. Give the generator this file plus one document's row and formatting style at a time.
2. **Read every document yourself and write or check the labels by hand.** The labels are the ground truth; if the same AI writes both the trap and the label, errors go unnoticed.
3. Make sure no document *accidentally* trips another rule (e.g. a generator adding a residuals clause to 01 "for realism").
4. Copy anchors straight out of the final `.txt`, after any edits.
5. Prefer a different model family for generation than the one being evaluated, so the eval isn't grading its own writing style.
