# NDA Review

Checks an NDA against a fixed playbook and lets a reviewer triage the results quickly, with every quoted piece of contract text proven to exist in the document.

## Document structure

**Document**:
The single NDA under review, as the user supplied it, never altered.
_Avoid_: Contract, file, agreement (when meaning the uploaded text)

**Clause**:
A numbered or paragraph-level segment of the Document, cut at the deepest numbering level present, with a stable ID and a human label such as "§3.2(a)".
_Avoid_: Section, paragraph, provision

**Parent Clause**:
The Clause whose numbering directly contains another Clause's (e.g. §3 for §3(a)); its text is context, not a citation target.

## Playbook

**Playbook**:
The fixed set of Rules every Document is checked against.

**Rule**:
One playbook requirement with a precise pass/fail definition and a Rule Kind.

**Rule Kind**:
Whether a Rule is REQUIRED (the Document must contain a conforming Clause) or PROHIBITED (the Document must not contain such a Clause).

**Trigger Term**:
A word or phrase associated with a Rule whose presence in the Document contradicts a model's claim that no relevant Clause exists.
_Avoid_: Keyword (too generic)

## Findings

**Finding**:
The single result of checking one Rule against the Document; there is exactly one per Rule.

**Finding Status**:
RISK_FOUND (a relevant Clause exists and violates the Rule), COMPLIANT (the Rule is satisfied), NOT_FOUND (a REQUIRED Rule's Clause is absent), or ERROR (the Rule could not be checked).
For a PROHIBITED Rule, absence is COMPLIANT, never NOT_FOUND. ERROR is never treated as a catch when measuring recall.

**Possible Miss**:
A Finding raised because a Trigger Term appeared even though the model reported no relevant Clause; always low confidence.

**Confidence**:
HIGH or LOW. Lowering Confidence is the only way a Finding is softened; a Finding is never removed and its Status is never relaxed toward COMPLIANT.

**Citation**:
A Clause ID plus an exact quote from that Clause that has been proven to occur in it.
_Avoid_: Reference, source, evidence

**Blocked Citation**:
A model-proposed Citation that failed verification after its retry; its quote is never shown to the reviewer.

**Citation Blocked Finding**:
A Finding whose Status requires a Citation but all of whose proposed Citations are Blocked.

**Redline**:
A proposed minimal edit: either a replacement of a verified span within a cited Clause, or, for NOT_FOUND, a suggested new Clause inserted after an existing one. At most one per Finding.
_Avoid_: Fix, amendment, markup

**Agent's Reasoning**:
The model's free-text explanation on a Finding; never presented as, or allowed to contain unverified, contract text.
_Avoid_: Rationale (in UI copy), summary

## Review

**Review Queue**:
The ordered list of Findings a reviewer works through.

**Decision**:
The reviewer's verdict on a Finding: APPROVE (agent is right, accept as-is), EDIT (agent is right, Redline rewritten), ESCALATE (needs a lawyer, with reason), or DISMISS (agent is wrong; false positive).

**Accepted Redline**:
A Redline whose Finding was decided APPROVE (the agent's text) or EDIT (the reviewer's text).

**Revised Document**:
The Document with every Accepted Redline applied; exported as plain text.

**Review Summary**:
The exported record of a review: each Finding's Status, Decision, reason and whether its Redline was applied.

**Coverage**:
The share of Clauses that were either mapped to at least one Rule or judged irrelevant to every Rule.

**Unmapped Clause**:
A Clause the agent neither mapped to a Rule nor judged irrelevant; a recall warning.

## Evaluation

**Labeled Document**:
An eval Document paired with the expected Finding Status for each Rule.

**Anchor Quote**:
An exact passage in a Labeled Document that identifies where a label's evidence lives, independent of Clause IDs.

**Positive**:
A label whose expected Status is RISK_FOUND or NOT_FOUND; recall is measured over Positives.
