# Unit 3 Plan — UI shell: repo picker, tree, status list (RON-296)

Status: plan-of-record ratified at Gate 4 (2026-09-03). The unit was resumed mid-flight by
a fresh session (no plan existed when work started — recorded as a deviation and closed by
this document, per the owner's "add per-unit plan docs" decision). Runtime facts:
Electrobun 2.0.1, Bun main process, vanilla TS + Vite, `@pierre/trees` `1.0.0-beta.6`
(exact pin — preact-11-beta rides inside).

## Outcome

Open a repository → `@pierre/trees` FileTree with `setGitStatus` coloring plus a
changed-file list, driven by micro-store state. A wrapper module isolates the beta
component so the API can move without touching app code (ADR-0001 R1 mitigation).

## Design

- **Wrapper seam** (`src/mainview/file-tree-wrapper.ts`): the ONLY module allowed to
  import `@pierre/trees`. Exposes `setPaths` / `setGitStatus` / `getRowCount` / `destroy`;
  `getRowCount()` lets callers assert the tree without piercing its shadow DOM.
- **Micro-store** (`src/mainview/store.ts`): minimal typed observable store — the app/UI
  state owner per the GOVERNANCE map. The shell renders from one `AppState`
  (root, info, status); every state change paints through a single `render()`.
- **Status mapping** (`src/mainview/git-status-mapping.ts`): pure porcelain-v2 → trees
  decoration mapping (worktree letter preferred, deleted paths stay in the status list
  since trees only decorates live paths, unmerged surfaces as modified).
- **CSS slugs**: raw porcelain letters (`?`, `.`, `!`) can't be class names — a slug map
  turns them into `status-untracked` / `status-clean` / `status-ignored`.
- **GitAdapter `worktreePaths`**: `ls-files -co --exclude-standard -z` (argv array,
  cwd pinned, `GIT_OPTIONAL_LOCKS=0`), NUL-safe for unicode/space paths, sorted.
- **SMOKE self-test**: DOM-driven — the main process sends `selfTestRun` over RPC, the
  webview platform hands off via a window event, `main.ts` runs the open-repo flow and
  reports through the typed bridge (replaces U1's platform-internal self-test).

## Dominant risk

Beta component API integration (RON-296's stated risk): mount, reset, status decoration,
and clean-up against `1.0.0-beta.6` in a real webview.

## Validation (as executed)

- `bun run check` GREEN: 38/38 tests — tsc strict, biome, bun test.
- Component tests mount the real beta FileTree into jsdom using the upstream harness
  pattern (pierrecomputer/pierre `packages/trees/test`): fixture paths render as
  `data-item-path` rows in the shadow tree, `setGitStatus` decorates rows and marks
  changed ancestor folders, `destroy()` is clean.
- Store + mapping unit tests (pure, no DOM).
- Built-app smoke over the real RPC bridge (webkit2gtk): `[SMOKE] ok=true treeRows=10010
  statusItems=1 entries=0` on a 10,000-file fixture repo, clean event-loop exit.

## Tracker points

- [RON-296](https://linear.app/rons-space/issue/RON-296): resumption start entry, Gate 4
  evidence entry; Evidence Log resumption entry; PR link + head SHA recorded at Phase 5.

## Rollback impact

Revert the unit's commits — read-only unit (no user-repo mutations; staging lands in U5).
All changes are additive to the webview shell and the platform contract.

## Done condition

Owner opens a repo → tree colors + changed-file list render from micro-store state;
component/store/mapping suites green; 10k-file smoke green; evidence recorded.
