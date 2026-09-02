# Declared Standard and Coverage Matrix

Use this document when auditing, extending, or versioning the high-assurance standard. It is
the canonical map of required controls; it is not loaded for ordinary engagements.

“100% covered” means every control declared below has an owning instruction, operator
explanation where needed, and evidence surface. It does not mean every future technology,
failure mode, or unknown risk has been predicted. When a real gap is found, add or revise a
control and update this matrix in the same change.

## Coverage states

- **Contract:** Binding behavior exists in `MASTER-PROMPT.md` or `SKILL.md`.
- **Guide:** Human/agent interpretation exists in `OPERATOR-GUIDE.md`.
- **Artifact:** An optional template makes the evidence reproducible.
- **Covered:** Contract exists and any necessary guide/artifact is linked.

## Governance, authority, and scope

| ID | Required control | Contract owner | Guide/artifact | State |
|---|---|---|---|---|
| G1 | Instruction precedence and untrusted-context boundary | Master operating contract 1 | Guide §§8–9, project-instructions template | Covered |
| G2 | Read-only discovery before project mutation | Master contracts 2 and 15 | Guide §§4–6 | Covered |
| G3 | Preserve user work and prohibit unapproved destructive/history actions | Master contract 3 | Guide §§9, 14 | Covered |
| G4 | Explicit phase approval; no approval inheritance | Master contract 5 and every phase gate | Guide §5, charter gate record | Covered |
| G5 | External action and human-only authority boundaries | Master contract 15, Phases 3/5/6 | Guide §§6, 14, charter authority matrix | Covered |
| G6 | Tracker start/completion/deviation/rollback evidence | Master contract 14 and phase tasks | Guide §13, evidence-log template | Covered |
| G7 | Canonical source-control/write authority and mirror direction | Master Phases 0/3/5 | Guide §14, project map/instructions | Covered |
| G8 | Proportional risk profile without omitted minimum evidence | Skill proportionality, Master contract 12 | Guide §19 | Covered |

## Product foundation and requirements

| ID | Required control | Contract owner | Guide/artifact | State |
|---|---|---|---|---|
| P1 | Automatic product-readiness assessment for every engagement | Master contract 7 and Phase 0 router | Guide §8 | Covered |
| P2 | Reuse only a current, approved, complete PRD/brief | Master Phase 0 router | Guide §8 | Covered |
| P3 | Automatic full PRD discovery for unresolved product/user/outcome scope | Master nested full PRD discovery | Guide §8, product-requirements template | Covered |
| P4 | Compact problem framing for narrow bug/maintenance/internal work | Master nested compact framing | Guide §§7–8, engagement charter | Covered |
| P5 | Evidence and assumptions distinguished; unknowns not invented | Master nested discovery and communication standard | Guide §§8, 13 | Covered |
| P6 | Users, problem, alternatives, urgency, success, non-users, constraints | Master readiness questions and PRD contract | Guide §8, product-requirements template | Covered |
| P7 | Market/competitor research conditional on decision value | Master discovery grounding | Guide §8 | Covered |
| P8 | Codebase/technical feasibility grounding before architecture choice | Master discovery feasibility | Guide §§8–10 | Covered |
| P9 | Minimum scope, hypothesis, non-goals, risks, open questions | Master discovery scope and PRD contract | Guide §8, product-requirements template | Covered |
| P10 | PRD approval is input, not implementation authorization | Master Phase 0 | Guide §8 | Covered |

## Design, implementation, and evidence

| ID | Required control | Contract owner | Guide/artifact | State |
|---|---|---|---|---|
| E1 | Reproducible current-state baseline or failure signature | Master contracts 4/6 and Phases 1/4 | Guide §§9–11, phase-plan template | Covered |
| E2 | Current versus target state kept distinct | Master Phase 1 | Guide §§9, 12, map template | Covered |
| E3 | Invariants, non-goals, and problems not to preserve | Master Phases 1–3 | Charter and phase-plan templates | Covered |
| E4 | Current official primary-source verification for unstable claims | Master contract 9 and Phase 2 | Guide evidence hierarchy, phase-plan source table | Covered |
| E5 | Three viable choices for competing ownership/technology | Master contract 10 and Phase 2 | Guide §§9–10, decision record | Covered |
| E6 | Small independently verifiable unit, one dominant risk, done condition | Skill and Master Phase 3 | Phase-plan unit template | Covered |
| E7 | Before-state regression proof when feasible | Master Phase 4 | Guide task-mode requirements, phase-plan template | Covered |
| E8 | Progressive validation and explicit skipped-gate record | Master contract 12 and Phase 4 | Guide §§13–14, evidence log | Covered |
| E9 | Full-diff and working-tree review | Master Phase 4 | Guide §§14–15 | Covered |
| E10 | Exact revision/environment required for acceptance claims | Master contract 4 and Phases 3–7 | Guide evidence hierarchy and checklist | Covered |
| E11 | Rollback states what it restores and cannot restore | Master contract 11 and Phases 2–7 | Guide §16, phase-plan rollback table | Covered |

## Mandatory code-review pillars

| ID | Pillar | Contract owner | Guide/artifact | State |
|---|---|---|---|---|
| Q1 | Intent, requirements, scope, non-goals, unrelated-change detection | Master Phase 4 code-review standard 1 | Guide §15 | Covered |
| Q2 | Correctness, domain/data invariants, contracts, input classes | Master standard 2 | Guide §15 | Covered |
| Q3 | Security, privacy, trust, identity, input, least privilege | Master standard 3 | Guide §§15, 17 | Covered |
| Q4 | Reliability, failure, retry, idempotency, concurrency, recovery | Master standard 4 | Guide §§15–16 | Covered |
| Q5 | Performance, scale, queries, memory, payloads, bounds, concurrency caps | Master standard 5 | Guide §§15, 18 | Covered |
| Q6 | Maintainability, clarity, cohesion, coupling, ownership, testability | Master standard 6 | Guide §15 | Covered |
| Q7 | Simplicity, dependency value, duplicate ownership, speculation | Master standard 7 | Guide §15 | Covered |
| Q8 | Compatibility, consumers, schema/data, rollout/coexistence/retirement | Master standard 8 | Guide §§15–16 | Covered |
| Q9 | Tests, regression/contract/failure evidence, observability/analytics | Master standard 9 | Guide §§15, 18 | Covered |
| Q10 | Operations, configuration, deploy, support, rollback/forward recovery | Master standard 10 | Guide §§15–16 | Covered |
| Q11 | Applicable usability, accessibility, consent, localization, profiles | Master standard 11 | Guide §§11, 15, 18 | Covered |
| Q12 | Diff, generated/lock state, supply chain, secrets, dead/delete-zone paths | Master standard 12 | Guide §§12, 15, 17 | Covered |

## Human and automated review findings

| ID | Required control | Contract owner | Guide/artifact | State |
|---|---|---|---|---|
| R1 | Exact-head identity and reviewer/CI settle window | Master Phase 5 steps 3–4 | Guide §§14–15, review-findings template | Covered |
| R2 | All platform feedback surfaces, including older revisions/follow-ups | Master Phase 5 step 4 | Guide §§14–15 | Covered |
| R3 | Findings are hypotheses verified against live code and current rules | Master contract 13 and Phase 5 step 5 | Guide §15 | Covered |
| R4 | End-to-end caller/input/auth/data/async/error/consumer trace | Master Phase 5 step 6 | Guide §15, review-findings template | Covered |
| R5 | Diagnosis assessed independently from suggested remediation | Master Phase 5 step 5 | Guide §15, review-findings template | Covered |
| R6 | Impact, likelihood, P0–P3 severity, and confidence based on evidence | Master Phase 4/5 | Guide §15, review-findings template | Covered |
| R7 | Root-cause correction and sibling-defect-class search | Master Phase 4/5 | Guide §15 | Covered |
| R8 | Complete eight-way disposition taxonomy | Master Phase 5 step 8 | Guide §15, review-findings template | Covered |
| R9 | Material scope/conflict/exception returns to human gate | Master Phase 5 step 10 | Guide §§5, 15 | Covered |
| R10 | Evidence-backed response; never merely “fixed” | Master Phase 5 step 11 | Guide §15, review-findings template | Covered |
| R11 | Focused and integrated regression proof on new exact revision | Master Phase 5 steps 9/12 | Guide §§14–15 | Covered |
| R12 | Conversation resolution, merge, deploy remain authority-bound | Master Phase 5 step 13 | Guide §15 | Covered |
| R13 | Style-only findings deferred to reliable automation unless meaningful | Master Phase 4 standard | Guide §§6, 15 | Covered |

## Release, operations, and governance continuity

| ID | Required control | Contract owner | Guide/artifact | State |
|---|---|---|---|---|
| D1 | Exact artifact/environment and configuration-contract verification | Master Phase 6 | Guide §§16–18, evidence log | Covered |
| D2 | Smoke/acceptance/security/performance/accessibility/analytics/recovery as applicable | Master Phase 6 | Guide §§17–19 | Covered |
| D3 | Honest baseline comparison with profiles and inference labeled | Master universal model and Phase 6 | Guide §§11, 18 | Covered |
| D4 | Code/config/data/external rollback distinguished from forward recovery | Master contracts/Phase 6 | Guide §16 | Covered |
| D5 | Follow-ups tracked separately from completed scope | Master Phase 6/7 | Guide §§13, 22 | Covered |
| D6 | Constitution/map/status/history single-owner documentation roles | Master Phase 1/6 | Guide §12, project templates | Covered |
| D7 | Intentional-removal delete-zone prevents accidental recreation | Master Phase 1/code review | Guide §12, status template | Covered |
| D8 | Resume packet preserves approvals, evidence, state, next unstarted work | Master Phase 7 | Guide §20, evidence/status templates | Covered |

## Maintaining full declared coverage

Before accepting a change to this standard:

1. Identify which control IDs it changes or adds.
2. Update the master contract first when behavior is binding.
3. Update operator explanation only when interpretation or execution needs detail.
4. Update or add an artifact only when it improves reproducibility.
5. Search for contradictory or obsolete text across all package files.
6. Validate every matrix row still has a real owner; never mark a row covered by aspiration.
7. Run the skill validator, portability scan, link/file checks, and a realistic dry-run of any
   changed router or decision table.
8. Record limitations honestly. Unknown future risks belong in ongoing review, not a false
   claim of universal perfection.

