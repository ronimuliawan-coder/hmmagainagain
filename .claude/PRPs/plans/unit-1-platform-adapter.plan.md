# Unit 1 Plan — Platform adapter & typed RPC (RON-294)

Status: approved scope (Gate 3, amended by golden-standard alignment). Runtime facts:
Electrobun 2.0.1, Bun main process, vanilla TS + Vite. This plan is executed only after
the owner confirms the U1 start.

## Outcome

A typed `platform` interface isolating everything OS-specific, with two implementations:
the real Electrobun adapter (main process ⇄ webview RPC) and an in-browser fake for fast
UI development and tests. This is the seam that keeps the Tauri fallback (ADR-0001) cheap.

## Contract (designed before implementation — the before-state test)

```ts
// src/shared/platform.ts (shape — refined during the unit)
interface Platform {
  openRepo(): Promise<{ root: string } | null>;          // native dialog, user-cancellable
  readRepo(root: string): Promise<RepoInfo>;             // validate: is a git repo
  watchRepo(root: string): AsyncIterable<FsEvent>;       // debounced change events
  runGit(root: string, args: string[], opts?: {
    signal?: AbortSignal                                 // cancellation
    onStdout?: (chunk: Uint8Array) => void               // incremental streaming
  }): Promise<{ code: number; stderr: string }>;
}
```

The fake adapter serves fixture repos from in-memory trees; the Electrobun adapter
implements it over typed RPC + `Bun.spawn`.

## Dominant risk

Streaming IPC backpressure and cancellation across the Electrobun RPC boundary — a chunked
stream must not buffer unbounded, and an aborted command must actually kill the child
process (no orphaned `git`).

## Steps

1. Contract test suite first (`src/shared/platform.test.ts`): a conformance suite that
   both adapters must pass (openRepo cancel, runGit streaming order, stderr capture,
   AbortSignal kills the child, watch debounce). Fails with no implementation — this is
   the before-state proof.
2. Implement the fake adapter (browser) over fixture repos in `tests/fixtures/`.
3. Implement the Electrobun adapter: main-process handlers (Bun) + typed RPC registration;
   webview client. Watch: recursive fs watch on the repo root, debounced (≥ 100 ms),
   coalesced per file set.
4. Wire `runGit` to spawn-kill semantics: argv arrays only, cwd = root, `--` handling
   documented for U2, stderr captured verbatim, exit codes propagated.
5. Manual smoke: hello-world window gains a hidden "Open repo" path that prints the
   selected repo root via the adapter (real UI arrives in U3).

## Validation

- `bun run check` green (typecheck + biome + bun test) before every commit.
- Conformance suite green on **both** adapters.
- Fixture-repo integration: watch event → status refreshed (stub) within debounce window.
- Cancellation proof: abort mid-`runGit` → no `git` child remains (`pgrep git` clean).

## Tracker points

- Issue [RON-294](https://linear.app/rons-space/issue/RON-294) start entry before the
  first commit; completion entry with validation evidence at the unit boundary;
  Evidence Log entry per material step.

## Rollback impact

Revert the unit's commits — no user-repo mutations exist in this unit (reads and dialogs
only). The invariants hold by construction.

## Done condition

Both adapters pass the conformance suite; smoke shows a real repo path crossing the RPC
boundary; `bun run check` green; evidence recorded.
