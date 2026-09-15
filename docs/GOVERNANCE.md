# Governance

The human-readable authority for building hmmagainagain unit by unit. Its objective is
speed with controlled authority: make one bounded change, prove it, preserve rollback,
record the evidence, and ask before crossing the next unit boundary. A machine-checkable
counterpart (`governance.json`) is deliberately deferred until automation needs to read
these gates (U3+); this document is authoritative until then.

## Authority order

When instructions disagree, use this order and stop if the conflict would change scope,
data authority, security, or the next unit:

1. Current system/developer instructions and the owner's latest explicit decision.
2. The approved PRD (`.claude/PRPs/prds/hmmagainagain-git-client.prd.md`).
3. The approved plan for the active unit (`.claude/PRPs/plans/`).
4. This governance guide.
5. Current `AGENTS.md` and `docs/GIT_WORKFLOW.md` safeguards.
6. Other active project documentation (README, ADRs).
7. Historical, archive-later, dormant, or imported reference material.

A target-state document never overrides a still-active production safeguard.

## Prime invariants

1. **Data safety:** the app never mutates a user repository's state without an explicit
   user action; destructive operations require confirmation; a crash or rollback of the
   app never corrupts or loses repository data.
2. **Local-first privacy:** no telemetry; network access limited to git push/pull
   transport; no credential storage — system git credential helpers / SSH agent only.
3. **No shell interpolation:** git via argument arrays only, cwd pinned to the opened
   repository, `--` separators before user-supplied paths, all through the GitAdapter.
4. **Measured budgets:** installer ≤ 40 MB (Linux) · cold start ≤ 300 ms · idle RAM
   ≤ 150 MB · smooth scrolling on a 1M-line diff. Measured evidence beats aspiration.
   (Installer was ≤ 20 MB until 2026-09-15: RON-301 measured the bun runtime at 97%
   of the 35 MB payload — arithmetically unreachable without a runtime swap.
   Owner-approved exception; Cottontail migration trigger-armed.)

## Ownership map (one owner per responsibility)

| Responsibility | Owner |
|---|---|
| Repository data mutations | System `git` binary via GitAdapter (single writer) |
| App/UI state | TypeScript micro-store; persisted settings JSON in platform config dir |
| Credentials | User's existing git setup (SSH agent / credential helpers) — the app stores nothing |
| Input validation | TypeScript boundary; GitAdapter re-validates and builds argv |
| Rendering | `@pierre/trees` (FileTree) + `@pierre/diffs` (CodeView) + `@pierre/theming` |
| Background work | @pierre worker pool (highlighting); main-process fs watcher (refresh) |
| Filesystem access | Main-process commands scoped to the opened repository root |
| Errors | Structured `{code, stderr, hint}` from GitAdapter; stderr shown verbatim |
| Analytics | None (invariant 2) |
| Packaging/deployment | Electrobun bundler; signing deferred to its owning unit |
| Logging | Local rotating file + in-app toasts; no external reporting |
| Recovery | Settings reset to defaults; repo operations never destructive by default |

## Unit gates

| Unit | Linear | Scope | Status |
|---|---|---|---|
| U0 | — (pre-ledger, recorded in Evidence Log) | Scaffold & toolchain proof | **Done** (2026-09-03) |
| U0.5 | [RON-293](https://linear.app/rons-space/issue/RON-293) | Governance alignment to golden standard | **Done** (2026-09-03) |
| U1 | [RON-294](https://linear.app/rons-space/issue/RON-294) | Platform adapter & typed RPC | **Done** (2026-09-03) |
| U2 | [RON-295](https://linear.app/rons-space/issue/RON-295) | GitAdapter read paths | **Done** (2026-09-03) |
| U3 | [RON-296](https://linear.app/rons-space/issue/RON-296) | UI shell: repo picker, tree, status | **Done** (2026-09-03) |
| U4 | [RON-297](https://linear.app/rons-space/issue/RON-297) | Diff view (CodeView + worker pool) | **Done** (2026-09-03) |
| U5 | [RON-298](https://linear.app/rons-space/issue/RON-298) | Staging & commit (file + hunk) | **Done** (2026-09-03) |
| U6 | [RON-299](https://linear.app/rons-space/issue/RON-299) | History & branch operations | **Done** (2026-09-04) |
| U7 | [RON-300](https://linear.app/rons-space/issue/RON-300) | Push / pull | **Done** (2026-09-15) |
| U8 | [RON-301](https://linear.app/rons-space/issue/RON-301) | Budget verification & Linux packaging | Pending |

Only the unit marked `In progress` may be implemented, and only from its approved plan.
Each unit's plan-of-record lives at `.claude/PRPs/plans/unit-<n>-<slug>.plan.md` and enters
the repo with the unit's changes (owner decision 2026-09-03, closing the U2/U3 gap).
Post-v1 units (Windows/macOS distribution, auto-update, line-level staging, blame, search,
host integrations) are gated behind a new owner decision, not this table.

## Conflicts

For any material ownership or technology conflict, present at least three choices —
recommended single owner, explicit hybrid/adapter, materially different alternative or
deferral — with benefits, drawbacks, migration/rollback impact, operational burden, and
evidence. The owner decides. Durable decisions are recorded in `docs/decisions/`
(currently [ADR-0001](decisions/ADR-0001-stack.md): Electrobun + subprocess git + vanilla
TypeScript, with Tauri as the documented fallback behind the platform adapter).
