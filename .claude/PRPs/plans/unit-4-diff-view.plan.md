# Unit 4 Plan — Diff view: @pierre/diffs CodeView + worker pool (RON-297)

Status: plan-of-record drafted at Gate 3 (2026-09-03) — executed only after the owner
confirms this document. Recon sources: pierrecomputer/pierre skills references
(api-core/api-worker/recipe-code-view/recipe-workers) + npm registry (2026-09-03).

## Outcome

`@pierre/diffs` CodeView renders diffs (worktree, staged, HEAD, any from..to range),
unified/split toggle, worker pool wired. The 1M-line diff budget is measured FIRST HERE
with numbers recorded in the tracker.

## Design

- **Wrapper seam** (`src/mainview/diff-view-wrapper.ts`): the ONLY module allowed to
  import `@pierre/diffs` (mirror of `file-tree-wrapper.ts`). Exposes: mount, `setPatch`,
  `scrollToFile`, `setDiffStyle`, `destroy`. `@pierre/diffs` pinned exact (1.3.6 latest,
  re-verified at install; deps: shiki ^3||^4, diff 9.0.0).
- **Parse path**: U2's `gitDiff` patch text → `parsePatchFiles(patch)` → one CodeView
  item per changed file (`{id: 'diff:<path>', type: 'diff', fileDiff, version}`).
  Clicking a file in the tree/status list scrolls to its item — no per-file RPCs in v1.
- **Worker pool**: `getOrCreateWorkerPoolSingleton({poolSize: 4, workerFactory: () =>
  new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url),
  {type: 'module'})}, {langs: [common set], theme: {light: 'pierre-light',
  dark: 'pierre-dark'}})` passed as the CodeView constructor's 2nd argument;
  `terminateWorkerPoolSingleton()` on teardown. Vite bundles the module worker.
- **Q2 resolved**: built-in `pierre-light`/`pierre-dark` theme names; custom theme
  mapping deferred until a visual need appears.
- **Toggle**: `diffStyle: 'unified' | 'split'` via CodeView `setOptions` (+ item version
  bumps), buttons in the diff toolbar.
- **Range presets** (toolbar): worktree (default) · staged · HEAD · from..to text inputs
  (no commit picker UI until U6). All flow through the existing `gitDiff` RPC.
- **Store**: diff state (open patch, mode, style) lives in the U3 micro-store; the diff
  pane renders from state like the rest of the shell.

## Dominant risk

1M-line diff end to end: the patch arrives as ONE RPC response string → main-process
string concat → RPC serialization → parse → highlight → virtualized scroll. The unit
measures each stage before optimizing; if a single stage breaks the budget, the fix
(streaming per-file fetch or chunked transfer) is decided with numbers in this unit.

## Steps

1. Parse/mapping unit tests first (fixture patch strings → expected item counts/ids) —
   before-state proof for the wrapper.
2. Install `@pierre/diffs` (exact pin) + wire the worker pool; wrapper seam with
   parsePatchFiles → items.
3. Diff pane UI: toolbar (range presets, unified/split), CodeView host, click-to-scroll
   from tree/status; store integration.
4. Fixture generator committed (`scripts/make-diff-fixture.ts`): repo with a ~1M-line
   changed file; deterministic content.
5. Measurement protocol: stage timings (git diff, RPC transfer, parse, first paint) +
   scroll smoothness (frame gaps), recorded in RON-297 + Evidence Log. Optimize only if
   a stage misses the budget; re-measure after any change.
6. Built-app smoke: open the fixture repo, render the diff, scroll; SMOKE flow extended
   only if it stays cheap.

## Validation

- `bun run check` green (unit tests for parse/mapping/store additions).
- Built-app smoke on a normal repo: diff renders for worktree/staged/HEAD; toggle works;
  click-to-scroll lands on the right file.
- 1M-line fixture: measured numbers recorded (per stage); budget verdict stated as
  measured fact, not aspiration.
- Component-level jsdom tests where they earn their cost (parse + item mapping; CodeView
  DOM behavior covered by the smoke + upstream's own suite).

## Tracker points

- RON-297: start entry (posted), plan confirmation entry, Gate 4 evidence, measurement
  numbers; Evidence Log at unit boundary.

## Rollback impact

Revert the unit's commits — additive UI + one dependency; read-only (no repo mutations).
Worker pool is torn down with the view; no external state.

## Done condition

CodeView renders worktree/staged/HEAD/from..to diffs with unified/split toggle and
click-to-scroll; worker pool active; 1M-line measurement numbers recorded with an honest
budget verdict; `bun run check` green; evidence recorded.
