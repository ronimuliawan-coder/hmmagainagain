# ADR-0003: Tauri 2 cutover (M6)

Date: 2026-09-25. Supersedes ADR-0001/ADR-0002 on the runtime choice.
Electrobun remains in git history as the pre-cutover shell.

## Decision

`dev` builds and ships the Tauri 2 shell (Rust core + system webview);
the Electrobun shell, Bun main process, Hutch toolchain, and typed-RPC
bridge are removed. The UI, the git architecture (subprocess git behind
the `Platform` seam), and the budgets survive unchanged.

## Why now

M0–M5 proved each piece with evidence: scaffold + CI (M0), invoke bridge
(M1), Rust read paths with fixture-oracle parsers (M2), writes + lanes
(M3), remotes + watcher + dialogs (M4), packaging matrix + soundcheck
theming harness (M5). The remote golden suite was ported to Rust at
cutover so no behavioral coverage was lost with the Bun engine.

## What moved, what died

- Survives: `src/mainview` (UI), `src/shared` (contract, fake, conformance)
  plus engine-agnostic git parsers relocated to `src/shared/git/`.
- Dies: `src/bun` (main process, GitAdapter, watcher, RPC), the Electrobun
  RPC client (`src/mainview/platform.ts` is now a Tauri→fake selector),
  `hutch.config.ts`, the Hutch devkit coupling in `vite.config.ts`.
- `product.yml` is gate-only (tsc + biome + bun test); all ship bundles
  come from the `tauri` matrix workflow.

## Consequences

- Toolchain: bun (web UI + tests) + stable Rust + node 24. No Hutch.
- `bun run dev` serves the web UI in a browser (fake platform);
  `bun run build` emits `dist/`, which the Tauri shell serves.
- Budgets re-baselined at cutover: installer proven (Linux .deb 2.5 MB
  shipped profile); shell runtime numbers re-measured with the real UI
  in the live Tauri window (spike numbers carried until then).
- Rollback: revert the M6 merge (Electrobun code paths restore intact).

## Open follow-ups (not blockers)

- Namespace Windows runners never schedule (matrix rides github-hosted
  until dashboard entitlement is confirmed).
- CI builds use LTO-relieved profiles for speed; shipped-profile bundle
  proof is a local/manual step until a release lane exists.
- RON-404 pathspec hardening rescoped to the surviving (Rust) engine.
