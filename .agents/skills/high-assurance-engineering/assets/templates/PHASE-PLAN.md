# Phase Plan: `[PHASE NAME]`

> One self-contained plan for one approved phase. Do not treat this target-state plan as
> completion evidence.

## Control record

- Parent charter/issue: `[LINK]`
- Phase objective: `[OUTCOME]`
- Approval owner: `[OWNER]`
- Status: `[DRAFT | AWAITING APPROVAL | APPROVED | IN PROGRESS | COMPLETE]`
- Approved scope/date: `[SCOPE / DATE / EVIDENCE]`
- Base revision/environment: `[REVISION / ENVIRONMENT]`

## Baseline and invariants

### Reproducible baseline

| Scenario/profile | Steps/tool | Current result | Evidence |
|---|---|---|---|
| `[SCENARIO]` | `[REPRODUCTION]` | `[RESULT]` | `[LINK/OUTPUT]` |

### Invariants

- `[BEHAVIOR/DATA/INTERFACE/OPERATIONAL INVARIANT]`

### Problems not to preserve

- `[PROBLEM]`

## Source evidence

| Decision surface | Official/current source | Checked at | Resolved version/behavior | Implication |
|---|---|---|---|---|
| `[SURFACE]` | `[PRIMARY SOURCE]` | `[DATE]` | `[FACT]` | `[PLAN IMPACT]` |

## Material choices

### Decision: `[RESPONSIBILITY OR CONFLICT]`

| Choice | Ownership/boundary | Benefits | Drawbacks | Migration/rollback | Operational cost | Evidence |
|---|---|---|---|---|---|---|
| **1 — Recommended single owner** | `[BOUNDARY]` | `[BENEFITS]` | `[DRAWBACKS]` | `[IMPACT]` | `[COST]` | `[LINKS]` |
| **2 — Explicit hybrid/adapter** | `[BOUNDARY]` | `[BENEFITS]` | `[DRAWBACKS]` | `[IMPACT]` | `[COST]` | `[LINKS]` |
| **3 — Alternative/replacement/deferral** | `[BOUNDARY]` | `[BENEFITS]` | `[DRAWBACKS]` | `[IMPACT]` | `[COST]` | `[LINKS]` |

- Recommendation: `[CHOICE AND WHY]`
- Human decision: `[CHOICE / DATE / EVIDENCE]`

## Acceptance matrix

| Dimension/scenario | Before-state proof | Expected result/budget | Validation | Environment | Required? |
|---|---|---|---|---|---|
| Normal path | `[PROOF]` | `[RESULT]` | `[CHECK]` | `[ENV]` | `[Y/N]` |
| Edge/failure | `[PROOF]` | `[RESULT]` | `[CHECK]` | `[ENV]` | `[Y/N]` |
| Security/privacy | `[PROOF]` | `[RESULT]` | `[CHECK]` | `[ENV]` | `[Y/N]` |
| Performance | `[BASELINE]` | `[PROFILE/BUDGET]` | `[CHECK]` | `[ENV]` | `[Y/N]` |
| Accessibility/usability | `[BASELINE]` | `[STANDARD/FLOW]` | `[CHECK]` | `[ENV]` | `[Y/N]` |
| Analytics/observability | `[BASELINE]` | `[EVENT/SIGNAL CONTRACT]` | `[CHECK]` | `[ENV]` | `[Y/N]` |
| Deployment/recovery | `[BASELINE]` | `[RESULT]` | `[CHECK]` | `[ENV]` | `[Y/N]` |

## Implementation units

### Unit `[N]`: `[OUTCOME]`

- Dominant risk: `[ONE RISK]`
- Owned surfaces: `[EXACT FILES/MODULES/SYSTEMS]`
- Prerequisites: `[PREREQUISITES]`
- Before-state test/reproduction/assertion: `[PROOF]`
- Implementation:
  1. `[STEP]`
  2. `[STEP]`
- Focused validation: `[CHECKS]`
- Integrated validation: `[CHECKS/CI]`
- Documentation update: `[CANONICAL FACT OWNER OR NONE]`
- Tracker updates: `[START / COMPLETE / DEVIATION]`
- Rollback/recovery impact: `[WHAT REVERT RESTORES AND DOES NOT RESTORE]`
- Done condition: `[EXACT EVIDENCE]`
- Gate after unit: `[APPROVAL REQUIRED]`

## Delivery and review

- Canonical repository/host: `[AUTHORITY]`
- Branch base/target: `[FLOW]`
- Commit strategy: `[STRATEGY]`
- Required CI/review: `[CHECKS/REVIEWERS]`
- Exact-revision rule: `[HOW IDENTITY IS PROVEN]`
- Preview/staging/canary: `[FLOW OR NOT APPLICABLE]`
- Merge/deploy authority: `[OWNER]`

## Rollout and rollback

| Trigger | Action | Decision owner | Validation | Data/external-state impact | Irreversible effect |
|---|---|---|---|---|---|
| `[TRIGGER]` | `[ROLLBACK OR FORWARD RECOVERY]` | `[OWNER]` | `[CHECK]` | `[IMPACT]` | `[EFFECT/NONE]` |

## Human-only actions

| When | Action | Exact scope | Verification | Rollback |
|---|---|---|---|---|
| `[GATE]` | `[ACTION]` | `[TARGET]` | `[CHECK]` | `[PROCEDURE]` |

## Completion packet

- Accepted exact revision/artifact/environment: `[IDENTITY]`
- Evidence log: `[LINK]`
- Deviations/exceptions: `[LIST]`
- Rollback impact: `[SUMMARY]`
- Documentation/tracker updates: `[LINKS]`
- Next phase or unit not started: `[NEXT]`

