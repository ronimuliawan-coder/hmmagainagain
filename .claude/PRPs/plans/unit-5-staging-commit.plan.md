# Unit 5 Plan — Staging & commit, file + hunk (RON-298)

Status: plan-of-record drafted at Gate 3 (2026-09-03) — executed only after the owner
confirms this document. This is the first unit that MUTATES the user's repository; the
prime data-safety invariant (explicit user action, no corruption, recoverable state) is
the design centerpiece.

## Outcome

Stage/unstage whole files and individual hunks, commit with a message; hook failures and
git errors display verbatim. `git apply --cached` carries hunk staging.

## Safety model (prime invariant 1)

- Every write is an explicit user action (button click); no automation writes to a user
  repo — the SMOKE staging flow only ever runs against a throwaway fixture.
- Staging/unstaging touch ONLY the index — recoverable at any time via `git reset`.
- Commits only ADD objects and move a ref; hook failures abort the commit and surface
  stderr verbatim (the app never bypasses hooks).
- `git apply --cached` fails honestly ("patch does not apply") when the index moved
  since the diff was taken — the error is shown, never forced.
- Discard of worktree changes is OUT of scope (destructive; not in RON-298).

## Design

- **`src/mainview/patch-surgery.ts` (pure, test-first):** split a unified patch into
  per-file patches → per-file hunks → filter hunks intersecting a new-file line
  selection → reassemble. Whole-hunk selection keeps hunk headers valid (no count
  recalculation). Edge cases: rename headers, hunk-less (binary) files, empty
  selection, multi-file patches.
- **GitAdapter write paths** (`src/bun/git/staging.ts` + adapter facade), all argv-only,
  cwd pinned, `--` before user paths, behind a **serialized write queue** (one
  in-flight mutation; main process stays the single writer):
  - `stagePaths(root, paths)` → `git add -A -- <paths>`
  - `unstagePaths(root, paths)` → `git restore --staged -- <paths>`
  - `applyIndexPatch(root, patch)` → `git apply --cached --whitespace=nowarn -` (stdin)
  - `commit(root, message)` → `git commit -m <message>` (hooks run; stderr verbatim)
- **RPC + Platform:** `stagePaths` / `unstagePaths` / `applyIndexPatch` / `commit`
  requests with the ok/error envelope; errors carry GitError.stderr verbatim. Mirrored
  in fake (fixture state toggles) and Bun platform.
- **UI:** per-file stage/unstage actions in the status list (driven by the entry's
  staged/unstaged letters) · diff-pane "Stage selected" when a line selection
  intersects whole hunks (disabled otherwise) · commit box (message + Commit button,
  disabled while nothing is staged) · every write triggers an immediate status+diff
  refresh through the existing store path.
- **Smoke:** dedicated `SMOKE_STAGE=1` self-test extension — stage → assert staged
  status → unstage → assert unstaged → stage → commit → assert clean — run against the
  fixture repo only (runbook documents that SMOKE_STAGE targets a throwaway fixture).

## Dominant risk

Index corruption / wrong partial staging (RON-298's stated risk). Mitigated by the
before-state golden tests: after EVERY staging op, assert the exact `git diff --cached`
content on a real temp repo — plus failure-path tests (conflicting index, hook
rejection, binary, CRLF).

## Steps

1. RED: `patch-surgery` tests against fixture patches (multi-hunk filter, rename,
   binary, empty selection).
2. Adapter writes + write queue; golden integration tests on temp repos asserting
   `git diff --cached` after each op; hook-rejection fixture (pre-commit hook script)
   asserting verbatim stderr and that the commit did NOT land; CRLF and binary paths.
3. RPC schema + Platform across fake/bun/rpc; fake fixture state simulation.
4. UI wiring (status-list actions, selection→hunk staging, commit box, verbatim error
   display).
5. SMOKE_STAGE fixture flow; `bun run build`; run the smoke against the throwaway
   staging fixture.

## Validation

- `bun run check` green (patch-surgery + adapter suites).
- Golden: `git diff --cached` asserted after every staging op (the RON-298 before-state).
- Hook rejection: commit blocked, stderr verbatim, ref unchanged.
- Smoke: staged → committed → clean on the fixture, `ok=true`.
- Manual: owner stages/commits in a scratch repo at Gate 4 if desired.

## Tracker points

- RON-298: start entry (posted), plan confirmation, Gate 4 evidence; Evidence Log at
  the unit boundary.

## Rollback impact

Unit commits revert cleanly. User-repo writes made THROUGH the app during the unit's
life are explicit user actions on the index/objects — recoverable via normal git
(`git reset`, reflog); the app introduces no new failure mode that loses data.

## Done condition

File + hunk staging and commit work end to end with verbatim error display; golden
`git diff --cached` assertions green; hook rejection proven; `bun run check` green;
evidence recorded.
