# Operator Guide: High-Assurance Engineering for Humans and Agents

This guide explains how to use the accompanying master prompt at any point in a project's
life: before the first file exists, during a migration, while adding a feature, when fixing
a production defect, or when raising the standard of an established codebase.

The system is stack-agnostic by design. It standardizes decisions, evidence, control, and
handoff—not a programming language, framework, host, issue tracker, or test runner.

## 1. What “high assurance” means here

High assurance means that important claims are reviewable:

- the requested outcome and the users it serves are explicit;
- the current state was inspected instead of assumed;
- baseline behavior or failure is reproducible;
- material choices and conflicts are visible to the human;
- implementation happens in approved, reversible units;
- checks are selected from the project's actual risks and toolchain;
- CI and review evidence belongs to the exact accepted revision;
- deployment and recovery boundaries are understood;
- documentation and tracking allow another person or agent to resume safely.

It does **not** mean adding every possible tool, producing paperwork for its own sake, or
claiming perfection. A small bug can use a small evidence packet. A data migration or auth
change needs deeper proof. The invariant is that the evidence is proportional and honest.

## 2. Package contents and canonical ownership

| Path | Role |
|---|---|
| `SKILL.md` | Thin agent entry point and non-negotiable operating rules |
| `references/MASTER-PROMPT.md` | Canonical full execution contract; copy/paste this when a skill system is unavailable |
| `references/OPERATOR-GUIDE.md` | Canonical usage and adaptation guide |
| `references/STANDARD-COVERAGE.md` | Audit map used only when changing or evaluating the standard itself |
| `assets/templates/` | Optional starting points for genuinely missing governance/evidence roles |

Do not copy policy text into multiple project documents. Link to one canonical owner for a
fact. If a target repository already has good instructions, architecture docs, a roadmap,
ADRs, or evidence conventions, keep them and map them to the roles described below.

## 3. Two ways to use it

### Option A — paste the master prompt

Use this when the agent has no portable skill mechanism:

1. Open `references/MASTER-PROMPT.md`.
2. Copy from **Prompt begins** through **Prompt ends**.
3. Fill the engagement configuration.
4. Paste it into a new agent session together with the concrete request.
5. Ask the agent to begin with Phase 0 only.

This is the most universal option.

### Option B — install the skill bundle

Copy the complete directory, not only `SKILL.md`:

```text
<this-repository>/skills/high-assurance-engineering/
    -> <target-repository>/.agents/skills/high-assurance-engineering/
```

Then ask the agent to use `high-assurance-engineering` for the task. Adapt the destination
folder to the agent harness if it uses a different skill convention. The target repository's
active instruction file should link to the installed skill; do not claim automatic loading
unless the harness actually supports it.

## 4. The human’s quick-start checklist

Before invoking the prompt, provide whatever is already known:

1. **Outcome:** What must be better or newly possible?
2. **People:** Who uses, operates, maintains, buys, or is affected by it?
3. **Why now:** What is the cost of delay or current pain?
4. **Constraints:** Budget, time, hosting, regulation, compatibility, data, team skill, or
   platform limits.
5. **Task mode:** New project, uplift, migration, feature, bug fix, or maintenance.
6. **Product foundation:** Is there a current approved PRD/brief, or should automatic discovery
   establish it?
7. **Authority:** What may the agent change locally and externally?
8. **Tracking:** Which issue/project should receive progress evidence?
9. **Approval owner:** Who confirms phase gates and irreversible actions?
10. **Quality priorities:** Which outcomes matter most and what would count as success?
11. **Known exclusions:** What must not change or be preserved?

Unknown answers may remain `DISCOVER`. Do not invent precision just to fill a field.

### Minimal invocation example

```text
Use the high-assurance-engineering skill.

Task mode: BUG_FIX
Workspace: /path/to/project
Outcome: Stop duplicate invoice creation during request retries.
Users: Customers, support staff, and developers.
Why now: It creates financial corrections and support work.
Tracker: PROJECT-123.
Authorized now: Read-only discovery and tracker updates. No code changes until Gate 3.
Approval owner: Me.
Quality priorities: Correctness, idempotency, auditability, safe data repair.
Begin with Phase 0 only.
```

### New-project invocation example

```text
Use the high-assurance-engineering skill.

Task mode: NEW_PROJECT
Workspace: /path/to/empty-or-new-repository
Outcome: Create a customer self-service portal for appointment booking.
Users: Visitors, customers, administrators, and developers.
Constraints: Must launch on free tiers and have a documented paid-scale trigger.
Tracker: DISCOVER; propose a local fallback if unavailable.
Authorized now: Read-only environment discovery and planning. Do not scaffold yet.
Approval owner: Me.
Quality priorities: Speed, accessibility, reliability, analytics integrity, simplicity.
Begin with Phase 0 only.
```

## 5. How strict phase gates work

The default gate policy is strict:

```text
Phase 0  Intake, authority, and automatic product-foundation routing
   └── if incomplete: nested PRD discovery or compact problem framing, then resume Phase 0
   ↓ explicit confirmation
Phase 1  Inventory and baseline
   ↓ explicit confirmation
Phase 2  Target design and choices
   ↓ explicit confirmation
Phase 3  Self-contained implementation plan
   ↓ explicit confirmation
Phase 4  Approved implementation unit
   ↓ explicit confirmation for each unit/phase
Phase 5  CI and review remediation
   ↓ explicit confirmation
Phase 6  Release and acceptance
   ↓ explicit acceptance
Phase 7  Handoff; next work remains unstarted
```

A confirmation is valid when the agent has clearly named the completed gate and proposed the
next one. “Continue” can approve that named next phase; it must not be stretched into approval
for all remaining phases. A new requirement returns work to the earliest affected gate.

The human may explicitly combine gates for low-risk work, but the combined output must still
contain the same decisions and evidence. The agent must never weaken a legal, security,
production, data-loss, credential, or destructive-action boundary for convenience.

## 6. Responsibilities by role

### Human approval owner

The human owns:

- the business outcome, priority, constraints, and acceptable tradeoffs;
- authorization for external or irreversible actions;
- selection among material architectural choices;
- accepted exceptions and residual risk;
- merge, production, data repair, and paid-resource decisions unless explicitly delegated;
- phase confirmation and final acceptance.

The human should challenge vague claims. Useful questions include:

- Which exact revision and environment produced this result?
- What was the baseline, and how was the comparison made?
- What applicable check did not run, and why?
- What does rollback fail to restore?
- Which source owns this fact?
- What complexity can we avoid or remove?
- Is this reviewer finding verified against current code?

### Primary agent

The primary agent owns:

- discovery, evidence collection, and explicit assumptions;
- a coherent current-state and target-state model;
- a plan with phase boundaries and done conditions;
- scoped implementation that preserves user work;
- progressive validation and full-diff review;
- accurate tracker and documentation updates;
- review remediation based on evidence;
- concise, self-contained handoffs.

The agent must stop when authority is missing or a choice materially changes the result. It
should not stop merely because work is difficult; safe read-only investigation and in-scope
alternatives should be exhausted first.

### Specialist or sub-agent

If the environment supports parallel agents, delegate only bounded work with explicit file or
responsibility ownership. Specialists may research, inspect, implement isolated surfaces, or
review. The primary agent remains responsible for:

- reading applicable instructions itself;
- preventing overlapping edits;
- reconciling conclusions against the same exact revision;
- running integrated validation;
- presenting one consistent plan and handoff.

Parallelism is an optimization, not a quality requirement.

### Reviewer

A reviewer should focus on correctness, invariants, edge cases, security boundaries, hidden
coupling, performance cliffs, rollout risk, and missing tests. Automated formatting should
settle style. Review findings remain hypotheses until verified against live code.

## 7. Choosing the task mode

| Mode | Use when | Essential first proof |
|---|---|---|
| `NEW_PROJECT` | No product implementation exists or a clean replacement is deliberately being created | Validated user problem, constraints, and minimal vertical-slice plan |
| `EXISTING_UPLIFT` | Raising maintainability, delivery, security, documentation, or quality without a single narrow feature | Current-state inventory and reproducible quality baseline |
| `MIGRATION` | Moving runtime, framework, datastore, platform, architecture, or major ownership | Current/target ownership map plus coexistence, cutover, retirement, and rollback gates |
| `FEATURE` | Adding a user or operator capability | User-visible acceptance scenarios and authorization/failure boundaries |
| `BUG_FIX` | Correcting unintended behavior | Reproduction and failing regression proof or equivalent stable signature |
| `MAINTENANCE` | Dependency, tooling, CI, operational, or compatibility change | Evidence of need plus compatibility and transitive-impact baseline |

If work spans modes, choose the dominant risk. A migration containing features remains a
migration unless features can be cleanly separated. A bug discovered during a feature should
be tracked separately when it has independent risk or rollback.

## 8. Automatic product discovery and PRD nesting

The operator never needs to remember a separate PRD command. Phase 0 always checks
product-foundation readiness and automatically chooses reuse, full discovery, compact
framing, or a human-approved exemption.

```text
High-assurance Phase 0
├── Current approved PRD/brief answers every applicable readiness question
│   └── Reuse it and continue the Phase 0 gate
└── Product foundation is incomplete
    ├── New product/project, substantial feature, or material user/process change
    │   └── Run full nested PRD discovery
    ├── Narrow bug, maintenance, refactor, or operational repair
    │   └── Run compact problem framing
    └── Purely mechanical and genuinely not product-affecting
        └── Record a justified, human-approved exemption
```

### Readiness is evidence, not file existence

Finding a document named “PRD” is insufficient. Verify that it is current, approved, linked to
the relevant users and problem, and answers the master prompt's readiness questions. Compare
its technical claims to current code and official sources. A stale PRD is context to revise or
supersede, not authorization to build.

### How the nested process runs

The main lifecycle pauses while discovery runs:

1. Confirm the initial request.
2. Establish users, observable problem, alternatives, evidence, urgency, and success signal.
3. Ground market/context assumptions when they can change the decision; inspect related
   codebase behavior when a repository exists.
4. Define vision, user trigger, job to be done, non-users, constraints, and unacceptable
   outcomes.
5. Assess technical feasibility and trace relevant integration/data/control flow without
   prematurely choosing the final architecture.
6. Agree on minimum scope, priorities, key hypothesis, non-goals, and open questions.
7. Generate the PRD in the repository's existing canonical format/location or propose a safe
   location when none exists.
8. Obtain explicit PRD approval, update tracking, and resume Phase 0.

Strict nested gates preserve the back-and-forth questioning that prevents an agent from
filling missing requirements with plausible prose. The human may combine question sets for a
well-understood low-risk task, but assumptions and unresolved questions remain visible.

### Market research is conditional; problem clarity is not

Market, competitor, and alternative research is required when positioning, build-versus-buy,
pricing, customer expectations, or current external patterns could change the product choice.
It is normally unnecessary for a narrow defect or mechanical maintenance task. In both cases,
the affected person/operator, observable need, desired result, scope, and success condition
must still be clear.

### Relationship to repository-specific PRD workflows

If discovery finds a proven repository-native PRD workflow, use it when it is compatible with
the master prompt's readiness and output contract. The embedded nested process remains the
portable fallback, so execution never depends on an agent knowing a command name or the human
remembering to mention it.

The approved PRD becomes input to engineering inventory and design. It does not prove that a
target architecture exists, authorize implementation, or satisfy a later phase gate.

## 9. Adopting it in an existing project

Do not begin by copying templates. Perform this sequence:

1. **Read active instructions.** Find the harness-specific instruction surface and all scoped
   instruction files that apply to the target area.
2. **Inspect the worktree.** Identify user changes before running formatters, generators, or
   migrations.
3. **Inventory documentation.** Include README, contribution rules, architecture, API/schema
   docs, ADRs, roadmap/status, runbooks, changelog, issue tracker, and generated references.
4. **Assign roles.** Map existing sources to constitution, map, status, and history.
5. **Verify claims.** Compare docs to code, tests, configuration, deployment, and Git.
6. **Propose dispositions.** For every conflicting instruction or stale document, recommend:
   - keep unchanged;
   - revise in place;
   - merge into another canonical source and replace with a link;
   - archive as historical context;
   - delete when misleading and safely recoverable.
7. **Establish baseline.** Run only safe, relevant checks and capture current failures without
   hiding them. Separate pre-existing failures from regressions.
8. **Plan slices.** Improve one dominant risk at a time with explicit compatibility and
   rollback boundaries.

### What “revise in place” means

Revise an existing document when it has the correct canonical role but stale or ambiguous
content. Typical revisions include:

- distinguishing current state from approved target state;
- replacing obsolete commands, paths, owners, versions, or deployment assumptions;
- moving live status out of permanent instructions;
- linking detailed policy instead of duplicating it;
- adding an explicit source of truth and verification command;
- recording intentional removals so agents do not recreate them;
- removing stack-specific rules that no longer apply;
- correcting unsupported claims while preserving a dated decision trail.

## 10. Starting a new project

A new project should prove a thin operational path before accumulating architecture:

1. Charter the problem, users, success measures, constraints, non-goals, and approval owner.
2. Research current official platform options and present three choices for material
   architecture decisions.
3. Define a minimal vertical slice that includes:
   - one real user outcome;
   - validation and error behavior;
   - an automated correctness check;
   - build and deployment proof;
   - basic observability;
   - recovery or rollback;
   - documentation of ownership.
4. Establish native formatter/static checks/tests/build and protected delivery before feature
   breadth.
5. Add dependencies only when the slice needs them. Record who owns the capability and how it
   is upgraded or replaced.
6. Define environments and configuration contracts without committing secrets.
7. Measure the empty and first-slice baseline so later optimization has an honest reference.

Avoid generating an elaborate directory tree, microservices, plugin layer, or abstraction
framework before a current requirement proves its value.

## 11. Converting goals into acceptance evidence

Broad goals are direction; they are not yet gates.

| Broad goal | Better acceptance definition |
|---|---|
| “Fast” | Named user flows, device/network profile, dataset, cold/warm condition, metric and budget |
| “Reliable” | Failure modes, timeout/retry behavior, recovery objective, alert or operator signal |
| “Secure” | Assets, trust boundaries, threat cases, authorization matrix, scan/test evidence |
| “Maintainable” | Ownership, coupling limits, setup/change workflow, static checks, documentation map |
| “Accessible” | Applicable standard/profile, keyboard and assistive-technology flows, known exceptions |
| “Analytics works” | Event contract, consent rules, environment routing, duplicate/loss checks, validation report |
| “Cheap/free tier” | Current usage assumption, published limits, monitoring, and a paid-upgrade trigger |
| “Latest” | Official source, resolution date, exact resolved version, compatibility proof, update policy |

When a metric depends on external conditions, test at least two honest profiles rather than
optimizing for one artificial score. Record tool versions and exact conditions.

## 12. Documentation governance without documentation sprawl

Every durable project needs four roles; it does not necessarily need four files.

| Role | Answers | Update trigger |
|---|---|---|
| Constitution | What must contributors and agents obey? | A binding workflow or safety rule changes |
| Map | What exists, who owns it, and where should I look? | Structure, boundary, ownership, or navigation changes |
| Status | What is healthy, blocked, being changed, or intentionally absent? | Current milestone, threshold, blocker, or delete-zone changes |
| History | Why was a hard-to-reverse choice, replacement, or removal made? | Material decision, incident, replacement, or intentional removal |

Git remains the history of ordinary edits. The issue tracker remains the history of task
progress. Do not turn an ADR log into a copy of every commit or a status page into an
architecture manual.

### Delete-zone discipline

When obsolete code, infrastructure, or documentation is intentionally removed, record:

- what was removed;
- why it must not return;
- its replacement;
- evidence or decision link;
- the condition under which reconsideration is allowed.

This prevents future agents from “fixing” the repository by recreating a rejected path.

## 13. Tracking and evidence

Use any tracker that supports durable comments or updates. The provider does not matter.

### Minimum tracker record

- objective and affected users;
- phase and gate status;
- approved scope and authority;
- current revision or baseline;
- start update for each material unit;
- completion evidence and exact revision;
- deviations, blockers, and decisions;
- rollback/recovery impact;
- next phase explicitly not started.

### Evidence hierarchy

Prefer evidence in this order:

1. Current machine-produced evidence from the exact revision and declared environment.
2. Current code, schema, configuration, and generated artifacts.
3. Official primary documentation and release/security sources.
4. Repository decisions and runbooks that still match implementation.
5. Issue comments, third-party explanations, and historical notes.
6. Memory or inference, clearly labeled and verified before it drives a decision.

An evidence log should point to durable CI, review, deployment, benchmark, or decision records.
Do not paste secrets or massive raw logs into it.

## 14. Source control, CI, and review

Discover and document the project's real topology. Do not impose a universal branch name or
hosting provider.

### Canonical authority

If multiple hosts or mirrors exist, designate one place where human changes, merges, branch
protection, and releases are authoritative. Mirrors should have an explicit purpose and
direction. Never “keep them in sync” with two independent write authorities.

### Branch and commit discipline

- Start from the approved base.
- Keep a unit coherent enough to review and revert.
- Avoid unrelated cleanup in a behavioral change.
- Preserve required history shape for automated synchronization and release tooling.
- Never force-push a protected or shared branch without explicit recovery approval.
- Review the complete diff and working tree before each external write.

### CI discipline

- Use the project's native gates and exact dependency state.
- Run focused checks early; let broader checks validate integration.
- Do not trigger expensive CI with avoidable partial pushes.
- Treat flaky and infrastructure failures as evidence to classify, not permission to ignore.
- Record exact run, revision, retry, and whether a retry changed code.
- A green earlier revision does not validate the current revision.

### Review remediation

The complete evaluation method is in Section 15. At the delivery-loop level, for each settled
review cycle:

1. Gather all supported feedback surfaces.
2. Verify each finding against the current exact revision.
3. Group findings into valid, invalid, already fixed, accepted exception, or out of scope.
4. Present material new scope or competing designs for approval.
5. Batch coherent fixes, rerun validation, and publish only when authorized.
6. Reply with evidence and wait for the new cycle to settle.
7. Do not hide old unresolved feedback merely because line numbers moved.

## 15. Code review and automated-review evaluation

Code review and review-comment evaluation are related but distinct:

- **Code review** asks whether the exact change is correct, safe, simple, operable, and proven.
- **Review-comment evaluation** asks whether a human or automated reviewer's diagnosis and
  proposed remediation are each factually correct for the current revision and project.

Automated reviewers—including services such as CodeRabbit—are valuable additional observers.
They are not authorities. Confident wording, severity labels, and generated patches do not
replace repository evidence.

### Review the system, not only the edited lines

Start from the approved outcome, requirements, non-goals, and exact revision. Inspect the full
diff plus the unchanged context needed to understand behavior. Trace:

```text
entry point / caller
  → input and trust boundary
  → validation and authorization
  → state, data, transaction, or side effect
  → asynchronous/concurrent work and failure handling
  → downstream consumer / user-visible or operational result
  → observability, rollout, and recovery
```

At each boundary, evaluate the twelve mandatory pillars in the master prompt: intent/scope,
correctness, security/privacy, reliability, performance/resource bounds, maintainability,
simplicity/ownership, compatibility/evolution, tests/evidence/observability,
operations/recovery, applicable user quality, and diff/supply-chain hygiene.

Inspect edge, invalid, adversarial, failure, retry, cancellation, partial-success, concurrent,
large-input, and degraded-dependency paths that apply. Search siblings for the same defect
class. Style-only preferences should not consume review cycles already settled by reliable
automation unless they change meaning.

### Separate diagnosis from remediation

Evaluate two independent claims:

1. **Diagnosis:** Is the reported behavior reachable, and does it violate an approved
   requirement or invariant?
2. **Remediation:** Would the suggested change correct the root cause while preserving
   ownership, compatibility, security, simplicity, and rollback?

This produces four common outcomes:

| Diagnosis | Suggested remediation | Correct response |
|---|---|---|
| Valid | Valid | Apply after scope/authority and regression proof are satisfied |
| Valid | Invalid or inferior | Fix differently and explain why |
| Invalid/stale | Superficially plausible | Rebut with current code and invariant evidence |
| Inconclusive | Any | Investigate or request missing evidence; do not present speculation as fact |

### Severity and confidence

Severity comes from demonstrated consequence and likelihood, not reviewer tone:

- **P0 critical:** credible exploit, data loss/corruption, systemic outage, or similarly
  catastrophic consequence requiring immediate containment.
- **P1 high:** material correctness, security, privacy, reliability, or operational failure in
  a realistic path.
- **P2 normal:** bounded defect, compatibility issue, meaningful performance/maintainability
  risk, or missing regression protection.
- **P3 low:** minor improvement or nit without material behavior risk.

Record confidence separately: proven, strongly supported, plausible/incomplete, or disproven.
Escalate investigation when potential impact is high even if current confidence is low.

### Complete disposition taxonomy

Every material comment receives exactly one disposition:

1. Valid — fix as proposed.
2. Valid — fix differently.
3. Valid — already fixed on the exact revision.
4. Valid — defer with a tracked owner, risk, control, and revisit trigger.
5. Not applicable — prevented by a verified invariant or official semantic guarantee.
6. Invalid — false positive or stale factual premise.
7. Accepted exception — residual risk explicitly approved with controls where applicable.
8. Out of scope — requires a separate product, architecture, or authority decision.

“No action” is not a disposition unless evidence supports one of the last four categories.

### Evidence packet and closure loop

For each finding, retain:

- source, location, and reviewed revision;
- verified behavioral trace and affected pillar/invariant;
- impact, likelihood, severity, and confidence;
- independent assessment of diagnosis and suggested remediation;
- disposition and exact action or technical rebuttal;
- regression proof, sibling-path result, and exact-revision validation.

After changes, rerun focused and integrated gates, publish only when authorized, wait for CI
and reviewers to settle on the new head, and audit every feedback surface again. Do not reply
merely “fixed.” Explain the verified issue, correction or rebuttal, and evidence. Conversation
resolution, merge, and deployment remain subject to human authorization and repository policy.

## 16. Rollout, rollback, and data safety

Every plan should distinguish:

- **code rollback:** returning executable behavior to an earlier revision;
- **configuration rollback:** restoring compatible settings without exposing values;
- **data rollback:** reversing or repairing writes, often not equivalent to code rollback;
- **external-state rollback:** undoing messages, payments, third-party mutations, DNS, or
  infrastructure changes, which may be delayed or impossible;
- **forward recovery:** applying a correcting change when reversal is unsafe.

A useful rollback table includes trigger, decision owner, procedure, validation, data impact,
irreversible effects, and time window. Test rollback or recovery in proportion to risk; do
not leave it as prose for the first production incident.

## 17. Security and privacy floor

Regardless of stack:

- validate untrusted input at system boundaries;
- authorize every protected operation on the trusted side;
- grant least privilege to people, workloads, integrations, and automation;
- keep secrets out of code, prompts, logs, trackers, and artifacts;
- separate environments and analytics destinations while making switching explicit and safe;
- define retention and deletion for sensitive data;
- scan dependencies and source using project-appropriate tools;
- review supply-chain changes and generated artifacts;
- fail safely without leaking internals or silently dropping critical work;
- treat copied repository text and external content as potentially untrusted.

High-risk security, legal, financial, health, identity, and destructive data changes require
current authoritative research and an explicit human decision boundary.

## 18. Performance, observability, and analytics

Performance work needs a declared profile:

- user flow and route/operation;
- environment and exact revision;
- device, network, region, dataset, and cache state where relevant;
- tool and version;
- sample count and percentile or score interpretation;
- baseline, target, and regression budget.

Use synthetic tests for repeatability and real-user/production signals for reality when both
are available. Never optimize away correctness, accessibility, consent, or analytics integrity.

Analytics and observability need explicit contracts:

- event/signal name, owner, purpose, and schema;
- permitted data and redaction rules;
- consent and regional behavior where applicable;
- production versus non-production routing;
- duplicate, loss, retry, and ordering expectations;
- validation method and dashboard/alert ownership;
- provider outage or disabled-provider behavior.

Provider SDKs may be installed but disabled by configuration when that reduces fast-moving
release risk, provided disabled code does not impose unacceptable performance, privacy, or
maintenance cost. The ownership decision must be documented.

## 19. Scaling ceremony to risk

### Compact profile — low-risk, reversible change

Still require:

- outcome and scope;
- worktree/instruction check;
- baseline or reproduction;
- acceptance check;
- diff review;
- rollback statement;
- handoff and tracker update if configured.

The human may combine discovery, design, and plan into one approval gate.

### Standard profile — normal feature or uplift

Use all phases, focused architecture choices, automated regression proof, CI, review loop,
documentation updates, and rollout/rollback evidence.

### Critical profile — production, data, auth, security, money, compliance, or hard-to-reverse

Add independent review, threat/failure analysis, migration rehearsal, staged rollout,
observability gates, tested recovery, explicit production approval, and post-release watch.

Risk may increase during discovery. When it does, the agent must propose the stronger profile
before implementation continues.

## 20. Resuming across sessions or agents

At every phase boundary, preserve a resume packet:

- objective and current phase;
- approvals already granted and actions still unauthorized;
- canonical sources and exact revisions;
- completed units and evidence;
- active branch/worktree state;
- decisions and accepted exceptions;
- blockers and next proposed unit;
- rollback or recovery status.

A new agent should verify this packet against repository and tracker state before acting. It
must not replay completed external actions or assume a planned target state already exists.

Start a fresh session after a major phase transition when context is noisy. Continue the same
session for closely coupled debugging or implementation units. Compact after a verified
milestone, not during active diagnosis.

## 21. Common failure patterns

Avoid these patterns:

- choosing a stack before agreeing on users, outcomes, and constraints;
- installing “latest everything” without compatibility and ownership proof;
- letting target-state docs masquerade as current state;
- running formatters or generators across user changes without inspecting the worktree;
- treating reviewer text as automatically correct;
- accepting an automated reviewer's proposed patch without independently validating the
  diagnosis, root cause, ownership, and regression risk;
- reviewing only changed lines without tracing callers, state, failure paths, and consumers;
- copying a severity label without demonstrating impact and likelihood;
- calling local success complete while exact-head CI or review is pending;
- measuring performance on only a favorable profile;
- claiming rollback when data or external side effects remain;
- maintaining two write-authoritative repository mirrors;
- duplicating the same rule in multiple docs until they drift;
- adding abstractions for hypothetical futures;
- silently skipping failed, unavailable, or expensive checks;
- progressing past a gate because the next step seems obvious;
- posting secrets or sensitive logs into tickets or agent context.

## 22. Completion checklist

Before accepting an engagement, the human and agent should be able to answer yes or explicitly
record an exception for every applicable item:

### Outcome and scope

- Is the user/business outcome achieved?
- Are non-goals and deferred work separate from completed scope?
- Were current versus target states kept distinct?

### Evidence

- Does evidence belong to the exact accepted revision and environment?
- Did all applicable local, CI, review, deployment, and acceptance gates settle?
- Are skipped checks and flaky/infrastructure failures recorded?

### Quality

- Are correctness and edge/failure paths covered?
- Were security, privacy, performance, accessibility, analytics, reliability, cost, and
  compatibility assessed where applicable?
- Did the change reduce or justify complexity?
- Did code review trace the relevant behavior end to end and inspect sibling defect paths?
- Does every material review finding have an evidence-backed disposition, severity/confidence,
  and independently assessed remediation?

### Operations

- Are configuration contracts, observability, rollout, recovery, and ownership clear?
- Is rollback honest about data and external state?
- Are production or paid actions explicitly approved?

### Governance

- Are constitution, map, status, and history facts owned once and linked?
- Are tracker updates, decisions, deviations, and rollback impact recorded?
- Does the resume packet say what has not started?

### Repository state

- Is the full diff understood and free of unrelated or sensitive changes?
- Does the branch/review/merge path respect the canonical authority?
- Is the local worktree state handed off accurately?

## 23. Suggested first adoption exercise

For an existing repository, do not start with a migration. Run a read-only standards audit:

1. invoke Phase 0 and Phase 1;
2. inventory instructions and docs;
3. map current delivery and quality gates;
4. capture one representative build/test/deploy baseline;
5. list the five highest-risk gaps and five highest-leverage simplifications;
6. choose one compact, reversible improvement;
7. execute it through the full evidence and handoff loop.

For a new repository, use one minimal vertical slice. The exercise is successful when another
human or agent can reproduce the setup, test, build, deployment, and recovery evidence without
private oral context.
