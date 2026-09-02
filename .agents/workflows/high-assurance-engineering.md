---
description: "Run a project or change through stack-agnostic, phase-gated, evidence-driven engineering from intake to handoff"
argument-hint: "[task mode] [outcome, workspace, tracker, authority, and constraints]"
---

# High-Assurance Engineering Workflow

Use the installed `high-assurance-engineering` skill for `$ARGUMENTS`.

Before task actions, read these installed files completely:

1. `.agents/skills/high-assurance-engineering/SKILL.md`
2. `.agents/skills/high-assurance-engineering/references/MASTER-PROMPT.md`

Read only the relevant sections of
`.agents/skills/high-assurance-engineering/references/OPERATOR-GUIDE.md` when installing,
adapting, teaching, auditing, or resuming the standard, or when the skill's routing points to
additional detail.

Treat `$ARGUMENTS` as the engagement configuration and concrete request. Mark missing facts
as `DISCOVER`; do not guess. Begin with Phase 0 only. Always run its product-foundation
readiness router; automatically reuse a complete approved PRD, run nested full discovery, run
compact problem framing, or document a human-approved exemption as the master prompt directs.
Establish tracking before repository changes when authorized, and obey strict phase gates
unless the approval owner explicitly sets a different policy.

During implementation and review, apply every mandatory code-review pillar and independently
evaluate each human or automated reviewer's diagnosis, proposed remediation, impact,
severity/confidence, sibling occurrences, and final disposition.

Do not install governance templates automatically. Inventory the target project's existing
instruction and documentation surfaces first. Use templates only for a role that is genuinely
missing and after the human approves the documentation disposition.
