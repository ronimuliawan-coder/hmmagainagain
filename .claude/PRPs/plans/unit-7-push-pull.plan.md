# Unit 7 Plan — Push / pull (RON-300)

Status: plan-of-record drafted at Gate 3 (2026-09-15) — executed only after the
owner confirms this document. Retroactive plan: a coherent WIP slice already
landed as `5be5b21` on `feat/ron-300-push-pull` (adapter, RPC, UI, golden
tests); this plan finishes it. No new owned surfaces beyond the WIP's.

## Outcome

Fetch/push/pull with streamed progress, AbortSignal cancellation, and honest
diverged/no-upstream/auth-failure states; system credential helpers only (the
app stores nothing); no force-push anywhere in v1. Remote-bar UI (Fetch / Pull
/ Push + progress + ahead/behind badge) works end to end without hangs.

## Safety model (prime invariants 1–3)

- Every remote op is an explicit user action (button click). Remotes mutate refs
  on BOTH sides, so all of fetch/push/pull go through the serialized write
  queue (`enqueueWrite`) — local ops can never race them.
- Pull is `--ff-only` by design: v1 has no conflict UI, so a diverged state
  fails with git's verbatim message instead of an implicit merge.
- Push runs hooks/credentials exactly as git does; failures (auth, no upstream,
  diverged, hooks) surface stderr verbatim, never forced or retried silently.
- All git invocations argv-only via `spawnGit`, cwd pinned, through the
  GitAdapter. No shell interpolation of remote/branch names.
- Test fixtures use `tmpdir()` bare remotes only — host-agnostic, no network,
  no credentials. Network/SSH proof is an owner-run manual smoke (human action
  H2); the agent never touches real remotes.

## Starting state (verified 2026-09-15, commit `5be5b21`)

Works: `src/bun/git/remote.ts` (args, queue, verbatim GitError), adapter
`remoteOp`, `spawnGit` stdout collection, RPC start/abort + events, platform
contract + fake, remote-bar UI, ahead/behind badge, 5 golden tests green.

Known gaps (each is a subunit below, not a surprise):

- **P1 — webview `gitRemote` promise never settles**
  (`src/mainview/platform.ts:318-338`): the executor registers only
  `remoteListeners` and never inserts `{resolve, reject}` into `remoteDone`,
  so the `gitRemoteDone` handler (`:185-196`) always finds nothing and drops
  the packet. Compare the correct `logDone` pattern (`:275-299`, registers
  `{onCommit, resolve, reject}` into `logListeners`). Symptom: UI hangs at
  "`<op> …`" forever on every remote click.
- **Abort unwired:** `bun/index.ts` mints an `AbortController` per op and
  `gitRemoteAbort` aborts it, but the signal is never passed into
  `remoteOp`/`spawnGit`; the webview `Platform.gitRemote` accepts no signal
  and there is no Cancel UI.
- **Unapproved toolchain switch** in the WIP (`package.json`: `hutch run` →
  direct `electrobun` npm bin). Decision point D1 below, not code.
- **Error-path goldens missing** for nonexistent remote and no-upstream push
  (diverged-pull and `-u` are covered).

## Design (per subunit)

- **U7a — settle the promise.** One-line-class fix: register
  `{ok, stderr, resolve, reject}` into `remoteDone` keyed by `opId` before
  awaiting `gitRemoteStart` (mirroring `logDone`), keep the early-done race
  check. Surface: `src/mainview/platform.ts` only.
- **U7b — thread cancellation end to end.** `Platform.gitRemote` accepts an
  optional `signal` (contract + fake + bun platform); rpc platform maps abort
  to `gitRemoteAbort(opId)`; `bun/index.ts` passes the controller's signal
  into `remoteOp`; Cancel button in `#remote-bar` aborts the in-flight op and
  resets `remoteOpRunning`/buttons. Surfaces: `shared/platform.ts`,
  `platform-fake.ts`, `bun/platform-bun.ts`, `bun/index.ts`,
  `mainview/platform.ts`, `mainview/main.ts`, `mainview/index.html`.
- **U7c — error-path goldens.** Adapter tests on tmpdir fixtures:
  nonexistent remote path → `GitError` with verbatim stderr, local ref
  unmoved; push with no upstream and no `-u` → verbatim failure. (Auth-path
  wording itself is owner-verified in H2; the test proves verbatim
  passthrough, not specific network text.)
- **U7d — decision, review, PR.** D1 resolution, Gate 4 full-diff review,
  PR `feat/ron-300-push-pull` → `dev` (merge commit only).

## Decision D1 — npm scripts: direct `electrobun` vs `hutch run`

- **Choice 1 — keep direct (recommended):** `electrobun dev/build` via the
  pinned `electrobun: 2.0.1` npm bin. Benefit: works with zero hutch state
  (proven during the outage); drawback: two toolchain paths (`hutch.config.ts`
  still hutch-based) until aligned.
- **Choice 2 — revert to `hutch run`:** single path via `hutch.config.ts`.
  Benefit: one toolchain idiom; drawback: re-couples daily dev to the hutch
  daemon/store that just vanished once.
- **Choice 3 — hybrid:** `dev` direct (speed), `build` via hutch (release
  parity). Benefit: each path earns its keep; drawback: two paths to maintain.
  Owner decides at Gate 4; the plan executes code identically under any choice.

## Dominant risk

Silent remote-side mutation or a hung UI that invites retry-spam against a
half-moved ref. Mitigated by: queue serialization (no concurrent remote ops),
`--ff-only` pull (divergence fails, never merges), verbatim errors, the U7a
regression proof (no hang), and abort actually killing the child (U7b test).

## Steps

1. **U7a RED:** regression proof for the settling bug — bun test with a
   mocked `electrobun/view` asserting `gitRemote` resolves on `gitRemoteDone`
   ok and rejects on failure. If the mock proves impractical within one
   attempt, fallback is the recorded manual fixture protocol (Fetch against a
   tmpdir bare remote, assert progress reaches "done"), labeled as such —
   no silent downgrade to "it compiled".
2. **U7a GREEN:** the `remoteDone` fix; regression + `bun run check` green.
3. **U7b:** contract `signal` addition → bun platform → index.ts threading →
   rpc abort mapping → Cancel UI; adapter abort test (aborted signal rejects
   promptly, child killed); manual cancel-click proof against fixture remote.
4. **U7c:** the two error-path goldens; full `bun run check` green.
5. **U7d:** D1 owner decision; Gate 4 full-diff review against all twelve
   pillars; evidence to RON-300; PR into `dev` (merge commit); owner merges.

## Validation

- `bun run check` green after every subunit (tsc + biome + bun test).
- U7a regression fails before, passes after (or labeled manual protocol).
- U7b: abort test green; Cancel click returns UI to idle, no late `done`
  packet resurrects state.
- Goldens: push advances bare ref · pull ff · diverged fails verbatim,
  nothing moved · fetch leaves local ref · `-u` sets upstream · bad remote
  and no-upstream fail verbatim (the RON-300 before-state).
- H2 SSH smoke `ok=true` by owner before merge.

## Non-goals

Force-push (no code path may gain it), conflict-resolution UI, merge pulls,
remote add/remove configuration UI, host integrations, multi-repo. Deferred
items return as tracked follow-ups, never hidden inside "done".

## Tracker points

- RON-300: Gate 3 start (posted), plan approval, per-subunit evidence,
  Gate 4 packet + PR link. Evidence Log at the unit boundary.

## Source-control plan

- Branch `feat/ron-300-push-pull` (exists, pushed, tracks
  `origin/feat/ron-300-push-pull`); base `dev` (`90db1e1` at plan time).
- One commit per subunit (U7a/U7b/U7c; U7d is review, no code); PR into
  `dev`, **merge commit only**; no force-push; GitHub sole authority.

## Human actions

- **H1:** approve this plan (Gate 3) — no code changes until then.
- **H2:** SSH smoke (owner, post-U7c): fetch + push + pull against a real
  remote; paste `ok=true/false` + verbatim failure if any. Agent never runs
  this (credentials, network).
- **H3:** D1 toolchain choice + PR merge approval (merge commit).

## Rollback impact

| Trigger | Procedure | Restores | Cannot restore |
|---|---|---|---|
| U7a/U7b/U7c defect | Revert the subunit commit; `bun run check` | Exact prior tree; fixtures are tmpdir-only | Nothing user-facing (no release) |
| Bad remote op THROUGH the app | Normal git (`git reset`, reflog, remote ref repair) | Local refs/objects (git's own durability) | Remote-side ref moves already pushed (external state; forward-fix by pushing the correction) |
| Toolchain (D1) regret | One-line script revert in `package.json` | Prior invoke path | Nothing (no data involved) |

## Done condition

Fetch/pull/push work from the buttons with progress, cancel, and verbatim
failures; all goldens green; H2 smoke ok; `bun run check` green;
Gate 4 review complete; PR merged into `dev`; evidence on RON-300.
