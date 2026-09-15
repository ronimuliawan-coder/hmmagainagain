# Unit 8 Plan — Budget verification & Linux packaging (RON-301)

Status: plan-of-record drafted at Gate 3 (2026-09-15) — executed only after the
owner confirms this document. This unit measures; it does not optimize, unless
a budget miss is resolved into an approved return with its own evidence. This
unit also produces the first release artifact, which arms the first
dev→master promotion (U8d, separate owner approval).

## Outcome

All four PRD budgets verified with reproducible, committed measurement
methods on the owner's machine profile — installer ≤ 20 MB (Linux) · cold
start ≤ 300 ms · idle RAM ≤ 150 MB · smooth 1M-line scroll — plus a packaged
Linux artifact. The U0/U4 watch-item (payload 34–37 MB vs 20 MB) is resolved
one honest way: met, accepted as exception, deferred with trigger, or returned
to Gate 2. No silent claims.

## Starting state (verified 2026-09-15)

- U4 numbers (RON-297, 1,000,006-line / 46 MB patch fixture): adapter fetch
  ~350–365 ms · RPC transfer 925 ms · parse 430 ms · e2e first load 1,355 ms ·
  scroll max/p95 frame gap 18.0 ms → **scroll budget met (measured)**.
- Installer payload: 34 MB (U0) → 36.7 MB (U4, shiki chunk > 500 kB warning)
  → today `artifacts/*Setup.tar.gz` 37M / `.tar.zst` 35M (U0-era, Sep 4).
- Toolchain: hutch 0.26.0, Electrobun 2.0.1 + bun 1.4.0 in `./.hutch/devkit`;
  `scripts/make-diff-fixture.ts` committed; `build/dev-linux-x64` present.
- Machine profile for every measurement below: EndeavourOS (KDE/Wayland),
  webkit2gtk 4.1, exact `dev` revision recorded per run, N samples stated,
  no other load claimed. Numbers without this header are not evidence.

## Safety model

- Measure-only: no user repository is touched; fixtures live in `tmpdir()`;
  build outputs are gitignored (`build/`, `dist/`, `artifacts/`, `.hutch/`).
- No credential, network (beyond existing git transports), or production
  action. Rollback: none needed (RON-301) — a bad measurement is deleted
  and re-run; the promotion in U8d has its own rollback row.

## Design (per subunit)

- **U8a — build path + baselines.** Step 0: reproduce a clean `stable`
  Linux build from this branch and record WHICH command does it
  (`hutch run build` vs direct `electrobun build` — D1 left two paths;
  first green path wins, documented in RECOVERY). Then commit
  `scripts/measure-budgets.sh` (size via `du -b` on the exact artifact
  file(s) the budget names; RAM via `ps -o rss` summed over main +
  webview processes after 60 s idle; cold start via the proxy in U8b;
  scroll via fixture + in-app timings) and record all four baselines.
- **U8b — cold-start proxy (honest definition first).** An app that stays
  open cannot be timed with `time`. U8b defines the proxy BEFORE measuring
  (e.g. exec → first webview paint marker, with any minimal startup
  instrumentation it needs, or launch-and-quit smoke flag if Electrobun
  supports one), N=10 runs, median/p95 vs 300 ms. If no honest proxy exists
  without app changes, the app change is specified here and reviewed, not
  smuggled in.
- **U8c — the 34→20 MB decision.** Decompose the payload (largest entries:
  shiki chunk? debug symbols? source maps? dev-only files? compression
  level?) with numbers; recon Electrobun packaging options from primary
  sources. Exactly one outcome, owned by the data: met · accepted exception
  (owner signs new number + rationale) · deferred with quantitative trigger
  · return to Gate 2 with a scoped redesign question. Optimization work
  itself is NOT in this unit.
- **U8d — artifact + promotion.** Package the Linux artifact (stable env;
  artifact names + hashes recorded), Gate 4 review, Gate 6 release evidence
  (installed launcher smoke on this machine, refreshed extract per the
  runbook trap), then the first **promotion PR `dev`→`master`** (merge
  commit) and the automatic dev↔master parity check. Merging the promotion
  is a separate explicit approval (H3), not bundled with U8 acceptance.

## Dominant risk

Budget miss, led by installer size (36–37 MB vs 20 MB): a miss with no
decision is the failure mode. Mitigated by forcing the four-way outcome in
U8c and by measuring composition before concluding anything.

## Steps

1. U8a: clean stable build (record command) → write `measure-budgets.sh` →
   baselines for all four (scroll reuses the committed fixture + U4 method).
2. U8b: define cold-start proxy → implement minimal instrumentation only if
   needed → N=10, verdict.
3. U8c: payload decomposition → packaging recon → four-way outcome + owner
   decision (H2).
4. U8d: package artifact → Gate 4 review → Gate 6 evidence → promotion PR →
   parity check. Promotion merge on H3 only.

## Validation

- `bun run check` green (measurement scripts included if lint-applicable).
- Every budget has: method (committed), profile header, N, verdict. Missing
  any of the four is a plan violation, not a pass.
- Scroll: same fixture + same frame-gap method as U4, compared numerically.
- Release: installed-launcher smoke `ok=true` on the exact promoted
  revision; `dev`/`master` parity verified post-promotion.

## Non-goals

Signing/store packaging (deferred per ownership map) · Windows/macOS
artifacts · update hosting (no host configured; `update.json` stays local)
· performance optimization (only via an approved return) · any behavior or
UI change to the app (cold-start instrumentation excepted, reviewed).

## Tracker points

- RON-301: Gate 3 start (posted), plan approval, per-subunit evidence with
  numbers, Gate 4 + Gate 6 packets, promotion link. Evidence Log at boundary.

## Source-control plan

- Branch `feat/ron-301-budget-packaging` (cut from `dev` @ `51ae193`);
  one commit per subunit (scripts + numbers); PR into `dev`, merge commit
  only; promotion PR `dev`→`master` under H3. No force-push; GitHub sole
  authority.

## Human actions

- **H1:** approve this plan — no implementation until then.
- **H2:** own the U8c four-way outcome (especially any exception or Gate 2
  return) and any budget redefinition.
- **H3:** promotion PR merge approval (after Gate 6 evidence). Post-v1 units
  (Windows/macOS, auto-update, line-staging, blame, search, integrations)
  stay gated behind a separate decision regardless.

## Rollback impact

| Trigger | Procedure | Restores | Cannot restore |
|---|---|---|---|
| Bad measurement/script | Delete outputs, fix script, re-run | Exact prior state (nothing user-facing) | Nothing (no data involved) |
| Bad packaged artifact | Delete `build/` output, rebuild | Clean rebuild from the same revision | Nothing (artifacts are gitignored, unsigned, undistributed) |
| Promotion regret | Revert the promotion merge on `master`; sync workflow re-parses parity | Prior `master` tip (git durability) | The fact a promotion happened (history shows it; harmless) |

## Done condition

Four budgets measured with committed methods + profile headers and stated
verdicts; installer gap resolved exactly one honest way; Linux artifact
packaged with hashes; Gate 4 + Gate 6 evidence recorded; promotion merged
under H3 with `dev`/`master` parity verified; evidence on RON-301.
