# ADR-0001: Stack selection

Date: 2026-09-03 · Status: Accepted (Gate 2, owner-confirmed) · Deciders: Ron (approval owner)

## Context

Greenfield desktop git client; primary user on EndeavourOS (KDE/Wayland); hard budgets:
installer ≤ 20 MB (Linux), cold start ≤ 300 ms, idle RAM ≤ 150 MB, smooth scroll on a
1M-line diff. Rendering quality target: Pierre's open-source `@pierre/diffs` +
`@pierre/trees` (both Apache-2.0, web-technology components). Owner constraint: TypeScript
end-to-end preferred ("100% type safe, only TypeScript if possible" — interpreted as: all
first-party code in TS with typed IPC/RPC boundaries).

## Decisions

### C1 — Desktop shell: Electrobun v2 ✅

- **Chosen:** Electrobun 2.0.1 (MIT). TS main process + typed RPC; system webview
  (webkit2gtk-4.1 on Linux — present on the dev machine at 2.52.6); hello-world ≈ 1.3 MiB;
  proven domain (existing git clients built on it: Patchline, Quiver).
- **Alternatives rejected:** Tauri 2.11.5 (most mature; Rust core — violates TS-first;
  recorded as documented fallback), Electron 44.1.1 (~85 MiB — violates 20 MB budget),
  defer-shell (unnecessary once Electrobun verified locally).
- **Known risks:** single-maintainer project, v2 churn, Community-tier Linux beyond Ubuntu.
  Mitigation: `platform` adapter interface keeps UI portable; Tauri fallback armed.

### C2 — Git engine: subprocess `git` via streaming Bun adapter ✅

- **Chosen:** system git binary, argv arrays only, porcelain output
  (`status --porcelain=v2 -z`), persistent `git cat-file --batch` for object reads,
  incremental log/diff streaming, serialized write queue, AbortSignal cancellation.
- **Alternatives rejected:** libgit2/git2-rs (Rust-only bindings; nodegit unmaintained),
  gitoxide (no TS bindings; its own crate-status shows push/hooks/config-write gaps),
  isomorphic-git (HTTP(S) only — no SSH; hooks not executed → fails v1 must-haves).
- **Runtime:** main process on **Bun** (`electrobun.config.ts: build.mainProcess: "bun"`)
  so `Bun.spawn` streaming semantics are guaranteed (Cottontail available if ever needed).

### C3 — UI layer: vanilla TypeScript + Vite ✅

- **Chosen:** no framework; Pierre components consumed via documented vanilla entries
  (FileTree, CodeView, WorkerPoolManager); micro-store for app state.
- **Alternatives:** React 19 (official Pierre entries exist — easy future migration),
  Svelte 5 (no Pierre bindings). React remains the escape hatch if UI velocity demands it.

## Version pins (Unit 0)

| Component | Version | Source |
|---|---|---|
| Electrobun | 2.0.1 | `hutch.config.ts` (`electrobun.version`) |
| Hutch CLI | 0.24.3 | npm forwarder `~/.hutch/npm/electrobun/2.0.1` (paired) |
| Cottontail | 0.5.0 | installed; unused while main process = bun |
| TypeScript | ^5.7.2 | package.json |
| Vite | ^6.0.3 | package.json |
| Biome | ^2.0.0 | package.json (lint/format) |
| Bun runtime | 1.4.0 (system) | dev machine |
| webkit2gtk | 2.52.6 (system) | dev machine |
| @pierre/diffs | 1.3.6 (Apache-2.0) | npm registry, verified 2026-09-03 — added at U4 |
| @pierre/trees | 1.0.0-beta.6 (Apache-2.0) | npm registry, verified 2026-09-03 — added at U3 |

## Consequences

- Two-process app (Bun main + system-webview UI) with typed RPC; git mutations always
  delegated to the git binary (data-safety invariant holds by construction).
- Installer size well under budget expected; measured proof due at U8.
- If Electrobun fails a later gate on Linux, fallback = Tauri 2.11.5 behind the `platform`
  adapter; UI and GitAdapter survive the swap.
