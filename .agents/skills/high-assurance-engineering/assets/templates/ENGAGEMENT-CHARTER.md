# Engineering Engagement Charter

> Optional template. Reuse an existing product brief, issue, or charter when it already owns
> these facts. Remove instructional notes after review.

## Identity

- Engagement name: `[NAME]`
- Task mode: `[NEW_PROJECT | EXISTING_UPLIFT | MIGRATION | FEATURE | BUG_FIX | MAINTENANCE]`
- Workspace/repository: `[LOCATION]`
- Canonical source-control authority: `[HOST / REPOSITORY]`
- Tracker project/issue: `[LINK OR IDENTIFIER]`
- Product-foundation route: `[REUSED PRD | FULL DISCOVERY | COMPACT FRAMING | APPROVED EXEMPTION]`
- Product brief/PRD evidence: `[LINK / PATH / TRACKER RECORD]`
- Approval owner: `[PERSON OR ROLE]`
- Current phase and gate: `[PHASE / AWAITING OR APPROVED]`
- Risk profile: `[COMPACT | STANDARD | CRITICAL]`

## Outcome

### Problem and why now

`[WHAT IS WRONG OR MISSING, WHO FEELS IT, AND COST OF DELAY]`

### Intended outcome

`[OBSERVABLE RESULT, NOT AN IMPLEMENTATION]`

### Users and stakeholders

| Group | Need | Risk if underserved |
|---|---|---|
| `[GROUP]` | `[NEED]` | `[RISK]` |

### Success signals

| Signal | Baseline | Target | Profile / measurement | Evidence owner |
|---|---:|---:|---|---|
| `[SIGNAL]` | `[VALUE OR DISCOVER]` | `[TARGET]` | `[CONDITIONS]` | `[OWNER]` |

### Non-goals

- `[EXPLICITLY OUT OF SCOPE]`

## Constraints and invariants

### Constraints

- Time: `[CONSTRAINT]`
- Cost: `[CONSTRAINT AND UPGRADE TRIGGER]`
- Hosting/runtime: `[CONSTRAINT]`
- Compatibility: `[CONSTRAINT]`
- Legal/security/privacy: `[CONSTRAINT]`
- Team/operations: `[CONSTRAINT]`

### Invariants that must survive

- `[BEHAVIOR, DATA, INTERFACE, ACCESS, OR OPERATIONAL INVARIANT]`

### Problems the work must not preserve

- `[LEGACY PROBLEM OR REJECTED PATH]`

## Authority matrix

| Action | Authorized now? | Owner / approver | Notes |
|---|---|---|---|
| Read-only repository inspection | `[YES/NO]` | `[OWNER]` | |
| Tracker updates | `[YES/NO]` | `[OWNER]` | |
| Local file changes | `[YES/NO]` | `[OWNER]` | |
| Branch / commit / push / PR | `[EACH EXPLICITLY]` | `[OWNER]` | |
| External service changes | `[YES/NO]` | `[OWNER]` | |
| Credentials or paid resources | `[YES/NO]` | `[OWNER]` | |
| Merge / deploy / production / data repair | `[EACH EXPLICITLY]` | `[OWNER]` | |

## Quality priorities

Mark applicability and define evidence in the approved phase plan.

| Dimension | Applies? | Priority | Initial expectation |
|---|---|---|---|
| Correctness | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Security/privacy | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Reliability/recovery | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Performance | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Maintainability/simplicity | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Developer experience | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Accessibility/usability | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Observability/analytics | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Delivery/operations | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Compatibility/portability | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |
| Cost/sustainability | `[Y/N]` | `[P0-P3]` | `[EXPECTATION]` |

## Gate record

| Gate | Deliverable | Status | Approval evidence |
|---|---|---|---|
| 0 — Intake | Authority, tracking, product readiness/artifact, engineering discovery scope | `[STATUS]` | `[LINK / DATE / APPROVER]` |
| 1 — Baseline | Inventory, baseline, invariants, gaps | `[STATUS]` | `[EVIDENCE]` |
| 2 — Design | Choices, target, budgets, rollback model | `[STATUS]` | `[EVIDENCE]` |
| 3 — Plan | Units, tests, delivery, human actions | `[STATUS]` | `[EVIDENCE]` |
| 4 — Execute | Approved unit evidence | `[STATUS]` | `[EVIDENCE]` |
| 5 — Review | Exact-revision CI/review evidence | `[STATUS]` | `[EVIDENCE]` |
| 6 — Release | Acceptance and recovery proof | `[STATUS]` | `[EVIDENCE]` |
| 7 — Handoff | Accepted outcome and next unstarted work | `[STATUS]` | `[EVIDENCE]` |
