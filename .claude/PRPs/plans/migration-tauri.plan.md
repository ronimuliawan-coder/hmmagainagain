# Migration Plan — Tauri main process + shell (owner-approved direction 2026-09-23)

Status: plan-of-record drafted — executed only after the owner confirms this
document, one unit at a time, each on its own branch with its own Linear
issue. This plan moves; it does not rebuild: the UI, the git architecture,
and the budgets all survive.

## Outcome

hmmagainagain runs on Tauri 2 (Rust main, system webview) instead of
Electrobun+Bun, measured against the same four budgets — with the installer
budget restored to ≤ 20 MB (Linux). Spike evidence (RON-384, same machine):
5.9 MB release binary, 0.28 s cold start to invoke-complete, git round trip
in ~3 ms, projected payload ≈ 8–12 MB.

## Starting state (verified 2026-09-23)

- `dev` green; UI is vanilla TS + Pierre vanilla entries; git engine is
  subprocess-git behind `spawnGit` + `Platform` seams (ADR-0001/ADR-0002).
- Electrobun 2.0.1 + Bun main ships 35–37 MB (budget exception stands).
- WebKitGTK 2.52.6 renders our UI identically under any shell (proven via
  offscreen harness) — engine quirks do not transfer as new work.
- Spike scaffold kept at `~/tauri-spike` (outside the repo): window boots,
  `git_status` command round-trips, release binary measured.

## Branching

`migration/tauri` integration branch cut from `dev`. Unit branches
`feat/ron-NNN-*` PR into `migration/tauri` (merge commits). `dev` is
untouched until M7, which promotes the migration through the normal
dev→master rules. Rollback before M7 = delete the integration branch.

## Safety model

- No unit touches a user repository beyond what the current app already
  does; fixtures for new Rust code live in `tmpdir()`.
- No credentials stored (system git helpers / SSH agent, as today).
- Each unit records evidence in its Linear issue before the next begins.

## Design (per unit)

- **M0 — Scaffold + CI skeleton.** Template-based Tauri shell in-repo
  (`tauri/` sidecar dir, repo stays TS-first), window boots, one placeholder
  command, Linux bundle building in CI. Proves toolchain + packaging path.
- **M1 — platform-tauri bridge.** `Platform` implemented over
  invoke/listen beside the Electrobun one (factory-selected); UI code
  untouched. Proven by running the existing webview against the bridge.
- **M2 — Git read paths in Rust.** status/diff/log/branches/worktree as
  Tauri commands (system git subprocesses, same argv contract); porcelain
  parsers ported with the existing fixtures as oracles.
- **M3 — Staging/commit + write queue.** Index writes, hunk apply, commit,
  per-repo serialization semantics preserved.
- **M4 — Push/pull + watcher + dialogs.** Progress streaming over Tauri
  events, `notify`-crate watcher with the same debounce contract,
  `tauri-plugin-dialog` folder picker.
- **M5 — Theming + packaging matrix.** Pierre entries verified in the Tauri
  webview; Linux stable ≤ 20 MB proof; Windows/macOS runners.
- **M6 — Cutover.** `dev` builds and ships the Tauri shell; Electrobun paths
  removed; docs/governance/ADR updated (ADR-0003). Rollback = revert M6.

## Validation (every unit)

`bun run check` stays green throughout (UI untouched); new Rust code ships
with `cargo test` coverage for parsers and the spawn contract; each unit
ends with a measured claim (sizes in MB, timings in ms) recorded in Linear.
M5/M6 re-run all four budget gates. No unit merges on aspiration.

## Open risks (owned, not hidden)

- Tauri v2 ACL/capabilities learning curve (spike tripping point) — budgeted
  inside M1, not assumed away.
- Rust onboarding for a TS owner — M2/M3 sized small; parsers are the
  gentlest entry (pure functions, fixture oracles).
- Windows/macOS CI runners — deferred to M5; Linux proves the pattern first.
