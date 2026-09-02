# Agent Instructions

hmmagainagain is a lightweight, fast, cross-platform (Linux/Windows/macOS) desktop git
client built on Electrobun, Pierre's open-source `@pierre/diffs` + `@pierre/trees`
components, and a subprocess-`git` engine. It is delivered through the
[`high-assurance-engineering`](.agents/skills/high-assurance-engineering/SKILL.md)
standard: phase-gated, evidence-driven, one unit at a time. Read
[`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) for the authority order, unit gates, and
ownership map, and read [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md) before doing
anything involving branches, merges, or pushes.

If prior chat or local agent state is unavailable, read
[`docs/runbooks/RECOVERY.md`](docs/runbooks/RECOVERY.md) before any change. It defines the
repository-backed resumption audit and the canonical sources a fresh agent must reconcile
before asking to continue.

The high-assurance lifecycle supplements this project's approved PRD
(`.claude/PRPs/prds/hmmagainagain-git-client.prd.md`), the Linear ledger
([hmmagainagain project](https://linear.app/rons-space/project/hmmagainagain-a0a2aa5c25e3)),
and the unit gates in [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) — it never replaces or
advances them. Reviewer agents (code-reviewer, security-reviewer, and the rest of the ECC
plugin set) are available natively as plugins in this repository; no local copies are kept.

## Branching, in one paragraph

`master` is the default branch. `dev` is the integration branch. Unit work happens on
`feat|fix|docs/ron-NNN-*` branches cut from `dev` and lands through pull requests **into
`dev`** (merge commits only). Batches of `dev` are promoted to `master` through promotion
pull requests; until the first release artifact exists (unit U8), `master` simply mirrors
`dev` and promotions are optional. A workflow syncs `dev` after anything lands on `master`,
so the two sit at the **same commit** between promotions. GitHub is the sole write and
merge authority. GitLab is a review replica only: never merge there, and apply review
findings on the originating GitHub pull-request branch
([runbook](docs/runbooks/GITLAB_REVIEW_REPLICA.md)).

## Rules that break things if broken

1. **Pull requests must be merged with "Create a merge commit".** Squash and rebase rewrite
   history into commits `dev` has never seen, which breaks the fast-forward property the
   `dev`↔`master` sync relies on. Both are disabled in repository settings; do not re-enable
   them.
2. **Never force push `master` or `dev`, and never sync them by hand.**
   `.github/workflows/sync-dev-to-master.yml` owns the sync. If it fails, read its run
   summary rather than fixing the branches manually. (Branch protection is not available on
   the GitHub Free plan for a private repository — the rule above plus the no-force design
   of the workflow are the compensating controls.)
3. **Git is invoked only through the GitAdapter**, with argument arrays (never shell
   strings), cwd pinned to the opened repository root, and `--` separators before
   user-supplied paths. The app never mutates a user repository's state without an explicit
   user action, stores no credentials, and sends no telemetry. See
   [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) invariants.
4. **Versions are pinned at the owning unit and never silently downgraded.** Electrobun is
   pinned in `hutch.config.ts`; @pierre packages are pinned in `package.json` when their
   units add them (U3/U4). Do not update a related dependency in a way that silently
   downgrades another.
5. **Do not edit the approved PRD or an approved unit plan retroactively.** Changes are
   superseded by a new committed version plus a Linear record, never rewritten in place.

## CI and validation

Today the gate is local: `bun run check` (typecheck + biome + bun test) must pass before
every commit. A GitHub Actions product workflow arrives with the first units that need
shared validation (U1 onward); until then CI is deliberately absent rather than
decorative. Avoid pushing many small commits to an open pull request once product CI
exists — each product-code push is a full run.

## Conventions

- Match the surrounding code. This repository favours explanatory comments that record
  *why* a non-obvious choice was made — preserve them and add to them when the reasoning
  is not self-evident.
- Target-state documentation is not evidence that a unit is complete. Status lives in the
  Linear project and Evidence Log, never in aspiration.
- Performance budgets are measured, not claimed: installer ≤ 20 MB (Linux), cold start
  ≤ 300 ms, idle RAM ≤ 150 MB, smooth scrolling on a 1M-line diff.

## Unit gates

- Only the unit marked `in-progress` in [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) may be
  implemented, and only from its approved plan under `.claude/PRPs/plans/`. Do not begin,
  complete, or advance a unit without explicit owner confirmation and Linear evidence.
- Record task start, completion evidence, validation, deviations, and rollback impact in
  the unit's Linear issue and the project Evidence Log. Never put secret values in Linear.
- For ownership or technology conflicts, present three choices (single owner / hybrid /
  alternative-or-deferral) and let the owner decide. Current stack decision record:
  [`docs/decisions/ADR-0001-stack.md`](docs/decisions/ADR-0001-stack.md).
