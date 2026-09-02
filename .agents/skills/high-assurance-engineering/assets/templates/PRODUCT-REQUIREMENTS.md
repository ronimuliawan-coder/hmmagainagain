# Product Requirements: `[PRODUCT / FEATURE / CAPABILITY]`

> Optional output template for the nested PRD workflow. Reuse the repository's current
> canonical format when one exists. Status remains draft until explicit approval.

- Status: `[DRAFT | IN REVIEW | APPROVED | SUPERSEDED]`
- Approval owner/evidence: `[OWNER / DATE / LINK]`
- Tracker: `[PROJECT / ISSUE]`
- Research checked at: `[YYYY-MM-DD]`
- Supersedes / superseded by: `[LINK OR NONE]`

## Problem and evidence

### Problem statement and cost of inaction

`[WHO EXPERIENCES WHAT OBSERVABLE PROBLEM, WHY IT MATTERS, AND COST OF DELAY]`

### Evidence and assumptions

| Claim | Evidence/source | Status | Validation needed |
|---|---|---|---|
| `[CLAIM]` | `[PRIMARY/REPOSITORY EVIDENCE]` | `[VALIDATED | ASSUMPTION | UNKNOWN]` | `[METHOD]` |

### Current alternatives

| Alternative/current behavior | Why people use it | Why it is insufficient | Evidence |
|---|---|---|---|
| `[ALTERNATIVE]` | `[VALUE]` | `[GAP]` | `[SOURCE]` |

## Users and context

| User/stakeholder | Context and trigger | Need/job | Successful outcome | Risk if underserved |
|---|---|---|---|---|
| `[USER]` | `[CONTEXT]` | `[NEED]` | `[OUTCOME]` | `[RISK]` |

**Job to be done:** When `[SITUATION]`, I want to `[MOTIVATION]`, so I can `[OUTCOME]`.

### Non-users

- `[WHO IS EXPLICITLY NOT TARGETED AND WHY]`

## Vision, capability, and hypothesis

### Vision

`[ONE-SENTENCE IDEAL END STATE]`

### Proposed capability

`[WHAT SHOULD BECOME POSSIBLE, WITHOUT PREMATURE IMPLEMENTATION DETAIL]`

### Key hypothesis

We believe `[CAPABILITY]` will `[SOLVE PROBLEM]` for `[USERS]`. We will know this is supported
when `[MEASURABLE RESULT UNDER DECLARED CONDITIONS]`.

## Success and measurement

| Signal | Baseline | Target | Profile/conditions | Measurement and owner |
|---|---:|---:|---|---|
| `[SIGNAL]` | `[VALUE/DISCOVER]` | `[TARGET]` | `[CONDITIONS]` | `[METHOD/OWNER]` |

## Scope

### Minimum useful/testable scope

`[SMALLEST SCOPE THAT CAN TEST THE HYPOTHESIS OR DELIVER THE REQUIRED OUTCOME]`

| Priority | Capability | Rationale and acceptance signal |
|---|---|---|
| Must | `[CAPABILITY]` | `[WHY / SIGNAL]` |
| Should | `[CAPABILITY]` | `[WHY / SIGNAL]` |
| Could | `[CAPABILITY]` | `[WHY / SIGNAL]` |
| Will not | `[CAPABILITY]` | `[WHY DEFERRED/EXCLUDED]` |

### Explicit non-goals

- `[NON-GOAL AND REASON]`

### Critical user/operational flow

1. `[TRIGGER]`
2. `[ACTION/STATE]`
3. `[SUCCESS OR FAILURE OUTCOME]`

## Constraints and unacceptable outcomes

- Constraints: `[TIME, COST, HOSTING, COMPATIBILITY, LEGAL, PRIVACY, TEAM, ETC.]`
- Invariants: `[BEHAVIOR/DATA/INTERFACE THAT MUST SURVIVE]`
- Unacceptable outcomes: `[HARM, REGRESSION, LOCK-IN, COST, OR FAILURE]`
- Problems not to preserve: `[LEGACY OR PROCESS FAILURE]`

## Grounding and feasibility

### Market/context research where applicable

| Finding | Source/date | Implication | Confidence/unknown |
|---|---|---|---|
| `[FINDING]` | `[SOURCE]` | `[IMPLICATION]` | `[STATUS]` |

### Technical context

- Existing behavior/infrastructure: `[CURRENT FACTS]`
- Integration/data/control-flow boundaries: `[BOUNDARIES]`
- Comparable internal patterns: `[LOCATIONS]`
- Feasibility: `[HIGH | MEDIUM | LOW]` because `[EVIDENCE]`
- Main technical risk: `[RISK]`

Do not treat feasibility notes as final architecture approval.

## Risks and open questions

| Risk/question | Could change | Evidence needed | Owner/trigger |
|---|---|---|---|
| `[ITEM]` | `[SCOPE/DESIGN/VIABILITY]` | `[METHOD]` | `[OWNER]` |

## Provisional implementation phases

| # | Outcome | Bounded scope | Dependencies | Success signal | Status |
|---|---|---|---|---|---|
| 1 | `[OUTCOME]` | `[SCOPE]` | `[DEPENDENCY]` | `[SIGNAL]` | pending |

These phases are planning inputs only. They are not authorized until the high-assurance design
and implementation gates approve them.

## Decisions and alternatives

| Decision | Selected direction | Alternatives | Rationale/evidence | Approval |
|---|---|---|---|---|
| `[DECISION]` | `[DIRECTION]` | `[ALTERNATIVES]` | `[WHY]` | `[EVIDENCE]` |

## Validation status

| Area | Status | Remaining work |
|---|---|---|
| Problem/evidence | `[VALIDATED / ASSUMPTION / UNKNOWN]` | `[WORK]` |
| Users/context | `[STATUS]` | `[WORK]` |
| Success measures | `[STATUS]` | `[WORK]` |
| Scope/non-goals | `[STATUS]` | `[WORK]` |
| Technical feasibility | `[STATUS]` | `[WORK]` |

- Recommended next evidence: `[ACTION]`
- Approval decision: `[APPROVE / REVISE / REJECT]`

