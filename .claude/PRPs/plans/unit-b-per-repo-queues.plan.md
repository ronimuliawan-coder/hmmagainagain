# Unit B Plan — Per-repo queues + conformance extension (RON-312)

Status: plan-of-record drafted at Gate 3 (2026-09-17) — executed only after the
owner confirms this document. Two CodeRabbit deferrals with a shared theme:
prove the write path and the contract surface, without changing behavior.

## Outcome

Mutations serialize per repository (a stalled push no longer blocks index
writes elsewhere), and the conformance suite pins status/log/branches/
remote/staging behavior across fake and Bun — with commit deliberately left
in the dedicated golden suites.

## Safety model

- No behavior change for single-repo flows: same-root ordering is identical
  to today (proven by the existing queue tests, updated in place).
- Queue keys are exact root strings (documented): the app opens one
  canonical path per repo. No realpath resolution (throws on missing paths;
  cure worse than disease for a single-window app).
- Conformance additions are self-cleaning: unique branch names switched
  back, stage→unstage round-trips, no commits, bare remotes in tmpdir.
- Abort maps are keyed by numeric op id and untouched by this unit.

## Design (per subunit)

- **B1 — per-repo queues.** `enqueueWrite(root, task)` over a
  `Map<string, tail>` with conditional delete on settle (only removes its
  own tail → bounded without a reaper). All 7 call sites (staging ×4,
  branches ×2, remote ×1) already hold `root`. Proof: same-root
  serialization (existing tests, updated signatures) + cross-root
  concurrency (slow-A/fast-B finishes B-first).
- **B2 — conformance extension.** New cases: gitStatus shape+reject,
  gitBranches current, create→switch→back round-trip, stage→unstage
  round-trip, gitLog skip/limit paging, gitRemote fetch-ok against a
  file-path bare remote. Fixture interface gains `remoteName`; the Bun
  builder adds a tmp bare origin (additive: no existing assertions read
  remotes); fake already serves all of it. RPC stays covered by the
  dedicated mock suites — the suite header is amended to name the real
  matrix instead of claiming all three.
- **Out on purpose:** commit in conformance (mutates the shared fixture
  ref; dedicated goldens own it), full RPC-matrix conformance (new harness;
  own unit if ever wanted).

## Dominant risk

Queue-key mismatch silently splitting one repo into two lanes (lost
serialization → index.lock races). Mitigated by exact-string keying plus the
same-root ordering test, and by the app's single canonical path per repo.

## Steps

1. B1: queue rework + caller updates + ordering/concurrency tests → gate →
   commit.
2. B2: fixture `remoteName` + Bun bare origin + new cases + header amend →
   gate → commit.
3. PR `feat/ron-312-per-repo-queues` → `dev` (merge commit); evidence to
   RON-312.

## Validation

- `bun run check` green per subunit.
- B1: same-root order preserved; cross-root overlap proven (not asserted).
- B2: new cases green on fake AND Bun; existing suites untouched in
  behavior; fixture builder changes additive-only.
- No user-repo contact; tmpdir fixtures only.

## Non-goals

Realpath/canonicalization of roots · commit in conformance · RPC-matrix
harness · any product behavior change · Cottontail (Unit D).

## Tracker points

- RON-312: Gate 3 start (posted), plan approval, per-subunit evidence,
  PR link. Evidence Log at boundary.

## Source-control plan

- Branch `feat/ron-312-per-repo-queues` (cut from `dev` @ `bed311a`);
  plan doc + one commit per subunit; PR into `dev`, merge commit only;
  batches into the post-v1 promotion with Units A/C/D. No force-push;
  GitHub sole authority.

## Human actions

- **H1:** approve this plan — no implementation until then.
- **H2:** PR merge approval.

## Rollback impact

| Trigger | Procedure | Restores | Cannot restore |
|---|---|---|---|
| B1/B2 defect | Revert the subunit commit; gate | Exact prior tree + behavior | Nothing (no data/external state) |

## Done condition

Per-repo serialization proven by test (not prose); conformance pins the
extended surface on both implementations with the real matrix stated;
gate green; PR merged; evidence on RON-312.
