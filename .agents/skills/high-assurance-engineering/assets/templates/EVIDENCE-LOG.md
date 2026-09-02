# Evidence Log

> Append concise, verifiable evidence. Link to durable logs rather than copying sensitive or
> enormous output. This is not a substitute for the issue tracker when one is canonical.

## Engagement

- Objective: `[OUTCOME]`
- Tracker/plan: `[LINK]`
- Canonical repository: `[LINK/LOCATION]`
- Approval owner: `[OWNER]`

## Evidence entries

### `[YYYY-MM-DD HH:MM TZ]` — `[PHASE / UNIT / EVENT]`

- Actor: `[HUMAN / AGENT / AUTOMATION]`
- Exact revision/artifact: `[IDENTITY OR NOT APPLICABLE]`
- Environment/profile: `[ENVIRONMENT AND CONDITIONS]`
- Claim evaluated: `[CLAIM]`
- Method: `[COMMAND, TOOL, RUNBOOK, OR REVIEW]`
- Result: `[PASS / FAIL / BLOCKED / MEASUREMENT]`
- Durable evidence: `[CI/REVIEW/DEPLOYMENT/BENCHMARK LINK OR SANITIZED OUTPUT]`
- Deviation/retry: `[WHAT CHANGED BETWEEN ATTEMPTS OR NONE]`
- Security/privacy note: `[REDACTION OR NONE]`
- Rollback/recovery impact: `[IMPACT OR NOT APPLICABLE]`
- Next gate: `[GATE AND APPROVER]`

## Accepted exceptions

| Exception | Reason | Risk | Compensating control | Owner | Expiry/revisit trigger | Approval |
|---|---|---|---|---|---|---|
| `[EXCEPTION]` | `[REASON]` | `[RISK]` | `[CONTROL]` | `[OWNER]` | `[TRIGGER]` | `[EVIDENCE]` |

## Final evidence matrix

| Required gate | Exact revision/environment | Result | Evidence | Accepted exception |
|---|---|---|---|---|
| Correctness | `[IDENTITY]` | `[RESULT]` | `[LINK]` | `[NONE/LINK]` |
| Security/privacy | `[IDENTITY]` | `[RESULT]` | `[LINK]` | `[NONE/LINK]` |
| Reliability/recovery | `[IDENTITY]` | `[RESULT]` | `[LINK]` | `[NONE/LINK]` |
| Performance | `[IDENTITY/PROFILE]` | `[RESULT]` | `[LINK]` | `[NONE/LINK]` |
| Accessibility/usability | `[IDENTITY/PROFILE]` | `[RESULT]` | `[LINK]` | `[NONE/LINK]` |
| Analytics/observability | `[IDENTITY/PROFILE]` | `[RESULT]` | `[LINK]` | `[NONE/LINK]` |
| Build/CI/review | `[IDENTITY]` | `[RESULT]` | `[LINK]` | `[NONE/LINK]` |
| Deployment/acceptance | `[IDENTITY/ENV]` | `[RESULT]` | `[LINK]` | `[NONE/LINK]` |

