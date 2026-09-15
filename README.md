# hmmagainagain

A lightweight, fast, cross-platform (Linux / Windows / macOS) desktop git client with
diffshub-grade diff and tree UX — built on Pierre's open-source `@pierre/diffs` and
`@pierre/trees` components, fully local, host-agnostic.

**Status:** Unit 0 (scaffold & toolchain proof) — see the Linear project "hmmagainagain"
for the tracker, Evidence Log, and approved PRD.

## Stack

Electrobun 2.0.1 (Bun main process) · vanilla TypeScript + Vite 6 · subprocess `git` ·
`@pierre/diffs` + `@pierre/trees` (from the diff-view/tree units onward).
Decision record: [docs/decisions/ADR-0001-stack.md](docs/decisions/ADR-0001-stack.md).

## Layout map

| Path | Role |
|---|---|
| `src/bun/` | Main process (Bun): window shell now; GitAdapter + fs watcher from U1/U2 |
| `src/mainview/` | Webview UI (vanilla TS + Vite): repo tree, status, diff views |
| `docs/GOVERNANCE.md` | Authority order, unit gates, ownership map |
| `docs/GIT_WORKFLOW.md` | Branch/merge rules and invariants |
| `docs/runbooks/` | Recovery + GitLab replica runbooks |
| `docs/decisions/` | Architecture decision records |
| `.claude/PRPs/` | Approved PRD (`prds/`) and unit plans (`plans/`) |
| `AGENTS.md` | Binding agent rules (constitution) |
| `electrobun.config.ts` / `hutch.config.ts` | Build/toolchain configuration (version pins) |

## Commands

```bash
bun run install:deps   # hutch install (respects hutch.lock)
bun run check          # typecheck + lint + tests
bun run dev            # run the app with watch
bun run build          # production build (hutch electrobun build)
```

Requires the hutch toolchain (`~/.hutch/bin/hutch`, npm-forwarder for Electrobun 2.0.1) and
Linux webkit2gtk-4.1 (present on Arch/EndeavourOS via `webkit2gtk` package).

## Quality budgets

Installer ≤ 20 MB (Linux) · cold start ≤ 300 ms · idle RAM ≤ 150 MB · smooth scrolling on a
1M-line diff. Measured evidence is recorded in the tracker at U4 and U8.
