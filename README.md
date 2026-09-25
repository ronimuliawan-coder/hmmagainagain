# hmmagainagain

A lightweight, fast, cross-platform (Linux / Windows / macOS) desktop git client with
diffshub-grade diff and tree UX — built on Pierre's open-source `@pierre/diffs` and
`@pierre/trees` components, fully local, host-agnostic.

**Status:** Tauri cutover (M6) — the shell is Tauri 2, the git engine is Rust
commands over subprocess `git`. See the Linear project "hmmagainagain"
for the tracker, Evidence Log, and approved PRD.

## Stack

Tauri 2 (Rust core + system webview) · vanilla TypeScript + Vite 6 · subprocess `git` ·
`@pierre/diffs` + `@pierre/trees`.
Decision record: [docs/decisions/ADR-0003-tauri-cutover.md](docs/decisions/ADR-0003-tauri-cutover.md)
(supersedes ADR-0001/ADR-0002 on the runtime).

## Layout map

| Path | Role |
|---|---|
| `src/shared/` | Platform contract + fake fixture + engine-agnostic git parsers |
| `src/mainview/` | Webview UI (vanilla TS + Vite): repo tree, status, diff views |
| `tauri/` | Tauri shell (Rust commands, packaging matrix, soundcheck harness) |
| `docs/GOVERNANCE.md` | Authority order, unit gates, ownership map |
| `docs/GIT_WORKFLOW.md` | Branch/merge rules and invariants |
| `docs/runbooks/` | Recovery + GitLab replica runbooks |
| `docs/decisions/` | Architecture decision records |
| `.claude/PRPs/` | Approved PRD (`prds/`) and unit plans (`plans/`) |
| `AGENTS.md` | Binding agent rules (constitution) |
| `tauri/src-tauri/` | Rust core (git commands, watcher) + bundling config |

## Commands

```bash
bun run install:deps   # bun install (frozen lockfile)
bun run check          # typecheck + lint + tests
bun run dev            # web UI with HMR (browser, fake platform)
bun run build          # web UI production build (dist/, served by Tauri)
```

Requires bun 1.4.0, a stable Rust toolchain (rustup), node 24, and
Linux webkit2gtk-4.1 (present on Arch/EndeavourOS via `webkit2gtk` package).
Ship bundles via the `tauri` CI workflow (Linux/macOS/Windows matrix).

## Quality budgets

Installer ≤ 20 MB (Linux) · cold start ≤ 300 ms · idle RAM ≤ 150 MB · smooth scrolling on a
1M-line diff. Measured evidence is recorded in the tracker at U4 and U8.
