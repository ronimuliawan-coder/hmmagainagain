# hmmagainagain — Engineering Constitution

Binding rules for any agent or human working in this repository. Status and history live in
the Linear tracker ("hmmagainagain" project: Evidence Log + PRD); architecture decisions in
`docs/decisions/`.

## What this is

A lightweight, fast, cross-platform (Linux/Windows/macOS) desktop git client with
diffshub-grade diff/tree UX. Stack decision record: `docs/decisions/ADR-0001-stack.md`.

## Prime invariants (never violate)

1. **Data safety:** never mutate a user repository's state without an explicit user action.
   Destructive operations require confirmation. A crash or rollback of this app must never
   corrupt or lose repository data.
2. **Local-first privacy:** no telemetry. Network access is limited to git push/pull
   transport. The app stores no credentials — system git credential helpers / SSH agent only.
3. **No shell interpolation:** git is invoked via argument arrays only, cwd pinned to the
   opened repository root, `--` separators before user-supplied paths.
4. **Budgets** (measured, not aspirational — see ADR-0001 and the PRD): installer ≤ 20 MB
   (Linux), cold start ≤ 300 ms, idle RAM ≤ 150 MB, smooth scrolling on a 1M-line diff.

## Stack (pinned — see ADR-0001 for rationale and alternatives)

- Electrobun **2.0.1** (pinned in `hutch.config.ts`), hutch CLI 0.24.3, main process: **Bun**
  (`build.mainProcess: "bun"` in `electrobun.config.ts`)
- UI: vanilla TypeScript + Vite 6 (no framework)
- Rendering (added in later units): `@pierre/diffs` 1.3.6, `@pierre/trees` 1.0.0-beta.6 —
  behind wrapper modules; pin exact versions, never use `latest`
- Git engine: system `git` binary via subprocess (streaming), single writer module
- Fallback if Electrobun fails a gate: Tauri 2.11.5 behind the `platform` adapter

## Commands

- `bun run check` — typecheck + lint + tests (must pass before every commit)
- `bun run dev` / `bun run build` — through the hutch toolchain
- `hutch` resolves from `~/.hutch/bin` (npm-forwarder paired: hutch 0.24.3 / electrobun 2.0.1)

## Process rules

- High-assurance phase gates (per-step stops): do not start the next unit without owner
  approval; every unit ends with a full-diff review against the mandatory review pillars and
  an Evidence Log entry in Linear.
- Source control: trunk-based on `dev`; conventional commits; GitHub = canonical
  write/merge authority; GitLab = review-only replica (never merge there).
- `.agents/` is owned by the operator — do not modify or reformat it.
- `/home/ron/Projects/pierre` is a read-only reference clone of the @pierre monorepo — never
  commit from it or modify it.
