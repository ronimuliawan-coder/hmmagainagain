# Code and Review Findings: `[CHANGE / PR / REVISION]`

> Optional evidence template. Use the review platform or tracker when it already owns this
> record. Never copy secrets or sensitive raw logs.

## Review identity

- Approved outcome/requirements: `[LINK]`
- Canonical repository/change: `[LINK]`
- Base revision: `[IDENTITY]`
- Exact reviewed head: `[IDENTITY]`
- Review cycle/time: `[N / YYYY-MM-DD HH:MM TZ]`
- Required CI/reviewers settled: `[YES/NO + EVIDENCE]`
- Reviewer/agent: `[IDENTITY]`

## End-to-end trace

```text
[ENTRY/CALLER]
  → [INPUT/TRUST/VALIDATION/AUTHORIZATION]
  → [STATE/DATA/TRANSACTION/SIDE EFFECT]
  → [ASYNC/CONCURRENCY/FAILURE/RECOVERY]
  → [CONSUMER/USER/OPERATIONAL RESULT]
  → [OBSERVABILITY/ROLLOUT/ROLLBACK]
```

## Mandatory pillar result

| Pillar | Result | Evidence or finding IDs |
|---|---|---|
| Intent and scope | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Correctness and invariants | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Security and privacy | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Reliability and failure behavior | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Performance and resource bounds | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Maintainability and clarity | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Simplicity and dependency value | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Compatibility and evolution | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Tests, evidence, and observability | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Operations and recovery | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Applicable user quality | `[PASS/FINDING/NA]` | `[EVIDENCE]` |
| Diff and supply-chain hygiene | `[PASS/FINDING/NA]` | `[EVIDENCE]` |

## Finding records

### `[FINDING-ID]` — `[SHORT TITLE]`

- Source/location/revision: `[HUMAN/AUTOMATION + LOCATION + IDENTITY]`
- Pillar and violated/protecting invariant: `[PILLAR / INVARIANT]`
- Diagnosis claim: `[CLAIM]`
- Verified behavioral trace or reproduction: `[EVIDENCE]`
- Impact and likelihood: `[CONSEQUENCE / CONDITIONS]`
- Severity: `[P0 | P1 | P2 | P3]`
- Confidence: `[PROVEN | STRONGLY SUPPORTED | PLAUSIBLE/INCOMPLETE | DISPROVEN]`
- Suggested remediation: `[SUGGESTION OR NONE]`
- Independent remediation assessment: `[CORRECT | INCOMPLETE | UNSAFE | OVER-ENGINEERED | OBSOLETE | NOT APPLICABLE]`
- Sibling-defect search: `[SURFACES CHECKED / RESULT]`
- Disposition: `[ONE OF THE EIGHT CANONICAL DISPOSITIONS]`
- Action or evidence-backed rebuttal: `[RESPONSE]`
- Regression proof: `[TEST/CONTRACT/REPRODUCTION]`
- Exact-revision validation: `[LOCAL/CI/REVIEW EVIDENCE]`
- Tracker/exception/next gate: `[LINK OR NONE]`

## Disposition summary

| Disposition | Count | Finding IDs |
|---|---:|---|
| Valid — fix as proposed | `[N]` | `[IDS]` |
| Valid — fix differently | `[N]` | `[IDS]` |
| Valid — already fixed | `[N]` | `[IDS]` |
| Valid — defer with tracked issue | `[N]` | `[IDS]` |
| Not applicable — verified invariant | `[N]` | `[IDS]` |
| Invalid — false positive/stale premise | `[N]` | `[IDS]` |
| Accepted exception | `[N]` | `[IDS]` |
| Out of scope — separate decision required | `[N]` | `[IDS]` |

## Cycle closure

- Changes/rebuttals published under authorization: `[YES/NO + IDENTITY]`
- Focused checks: `[RESULT/EVIDENCE]`
- Integrated CI: `[RESULT/EVIDENCE]`
- New exact head: `[IDENTITY]`
- New reviewer cycle settled: `[YES/NO + EVIDENCE]`
- Every material finding disposed: `[YES/NO]`
- Conversations resolved only under policy/authorization: `[YES/NO/NA]`
- Remaining exception or next unstarted work: `[ITEM]`

