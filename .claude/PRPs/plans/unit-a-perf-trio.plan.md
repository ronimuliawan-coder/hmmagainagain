# Unit A Plan — Perf trio (RON-313)

Status: plan-of-record drafted at Gate 3 (2026-09-15) — executed only after the
owner confirms this document. Follow-through on three CodeRabbit findings the
promotion review deferred with budgets holding. Each subunit lands separately
with before/after numbers; none may regress correctness for speed.

## Outcome

1M-line diff flows faster and the history pane scales: one git traversal per
diff request, cancelled stale diffs, windowed history DOM. Budgets stay green
throughout; any subunit that cannot prove faster-or-equal does not land
(fallbacks below, not silent downgrades).

## Safety model

- Measure-only fixtures in `tmpdir()`; no user repos touched.
- A1 keeps ONE stats implementation in production: the new patch-derived
  parser replaces numstat only after differential proof against real git
  across renames, binary, CRLF, unicode, mode-only, and empty diffs.
- A2 aborts only superseded requests; the newest always runs to completion.
- A3 changes DOM structure, never data flow: the commit array keeps growing
  (cheap objects), only rendered rows are bounded.

## Design (per subunit)

- **A1 — single traversal.** New `parsePatchStats(patch): DiffFile[]` in
  `src/bun/git/diff.ts` (hunk `+`/`-` counts; `rename from/to`; `Binary
  files … differ` → -1/-1; mode-only/new-file/deleted-file headers → 0/0).
  `diff()` spawns once; `parseNumstat` + the numstat spawn are deleted.
  Proof: differential test shelling real `git diff --numstat` beside the new
  parser on every fixture flavor + adapter-ms before/after on the 1M
  fixture. Fallback (recorded, not silent): concurrent `Promise.all` halves
  wall time but keeps two traversals — only if the parser proof stalls.
- **A2 — cancel stale diffs.** `signal?: AbortSignal` on
  `Platform.gitDiff` → new `gitDiffAbort` RPC + server-side map (mirrors
  `gitRemoteAbort`; fake accepts-and-ignores per contract note).
  `refreshDiff` keeps the active controller, aborts before starting newer.
  Proof: adapter pre-abort rejects; webview mock abort-mapping test (U7b
  pattern). The seq-guard stays as the final stale-result backstop.
- **A3 — windowed history.** Pure `windowRows(total, scrollTop, rowH,
  viewportH, overscan)` (unit-tested) driving spacer divs around ~60
  rendered rows; row height measured from the first row with a constant
  fallback; pagination cursor and Older flow unchanged; data array uncapped
  (objects are cheap — stated, revisit if measured otherwise). Proof: math
  tests + one GUI scroll sample on a deep-history fixture (coordinated
  window pop, U8a pattern).

## Dominant risk

A1 parser divergence on an exotic diff shape (the numstat path carries
years of git's own edge handling). Mitigated by the differential harness
across six fixture flavors — the subunit lands only on full agreement.

## Steps

1. A1: `parsePatchStats` + differential tests + six fixtures → switch →
   adapter-ms before/after → gate → commit.
2. A2: contract + RPC + server map + UI controller → abort tests → gate →
   commit.
3. A3: `windowRows` + tests → list rework → math tests + GUI scroll sample
   → gate → commit.
4. PR `feat/ron-313-perf-trio` → `dev` (merge commit); numbers to RON-313.

## Validation

- `bun run check` green per subunit.
- A1: differential agreement on all flavors; adapter-ms faster-or-equal.
- A2: pre-abort rejects; mock proves abort mapping; no behavior change
  otherwise.
- A3: math tests green; scroll sample at p95 ≤ 18 ms or the subunit
  returns to design (nocu claim without the sample).
- No budget regresses; failures stop the subunit (fallbacks recorded).

## Non-goals

New budgets or thresholds · shiki/worker changes · history search/filter ·
any behavior change outside the three paths · Cottontail (Unit D).

## Tracker points

- RON-313: Gate 3 start (posted), plan approval, per-subunit numbers,
  PR link. Evidence Log at boundary.

## Source-control plan

- Branch `feat/ron-313-perf-trio` (cut from `dev` @ `bed311a`); plan doc +
  one commit per subunit; PR into `dev`, merge commit only; batches into the
  post-v1 promotion with Units B–D. No force-push; GitHub sole authority.

## Human actions

- **H1:** approve this plan — no implementation until then.
- **H2:** one coordinated GUI window for the A3 scroll sample.
- **H3:** PR merge approval.

## Rollback impact

| Trigger | Procedure | Restores | Cannot restore |
|---|---|---|---|
| A1/A2/A3 defect | Revert the subunit commit; gate | Exact prior tree + behavior | Nothing (no data/external state) |
| Parser doubt post-merge | Revert to numstat path via revert commit | Proven old path | The measured time only |

## Done condition

One traversal per diff with differential proof; stale diffs die on abort;
history DOM bounded with scroll sample at budget; gate green; PR merged;
numbers on RON-313.
