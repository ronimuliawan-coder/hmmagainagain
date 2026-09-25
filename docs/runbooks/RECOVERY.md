# Recovery Runbook

If prior chat, local agent state, or the development installation is unavailable, reconcile
the facts below **before asking to continue any unit**. The resumption audit is: verify
git state, verify toolchain, verify gate, then compare against the Linear ledger.

## Canonical sources

| Fact | Canonical source |
|---|---|
| Objective, scope, approved constraints | Approved PRD: `.claude/PRPs/prds/hmmagainagain-git-client.prd.md` |
| Authority order, unit gates, ownership | [`docs/GOVERNANCE.md`](../GOVERNANCE.md) |
| Durable stack decisions | [`docs/decisions/ADR-0001-stack.md`](../decisions/ADR-0001-stack.md) |
| Current status, evidence, deviations | Linear project "hmmagainagain": per-unit issues RON-293…RON-301 + Evidence Log document |
| Branch/merge rules | [`docs/GIT_WORKFLOW.md`](../GIT_WORKFLOW.md) |
| Binding agent rules | [`AGENTS.md`](../../AGENTS.md) |

## Resumption audit (in order)

1. `git status`, `git branch -a`, `git log --oneline -10` on
   `/home/ron/Projects/hmmagainagain` — canonical repo, `origin` = GitHub
   (`ronimuliawan/hmmagainagain`, private), `gitlab` = review replica. `master` is default,
   `dev` is integration. Working-tree changes not in a unit branch belong to the owner —
   preserve them.
2. `gh pr list` — open PRs are the truth for in-flight units.
3. Compare the last merged unit against the GOVERNANCE unit table; the next unit starts
   only with owner confirmation.
4. Toolchain check: `bun --version` (1.4.0), `cargo --version` (stable via
   rustup), `node --version` (24). No Hutch/Electrobun anymore (removed at
   M6 cutover): if `~/.hutch` still exists it is inert — leave it, do not
   reinstall.
5. `bun run install:deps` if `node_modules` is missing, then `bun run check` — must be
   green before any change.
6. Reference clone `/home/ron/Projects/pierre` is read-only; if missing, it is optional —
   re-clone only if the active unit needs Pierre API recon.

## Machine profile (primary dev machine)

EndeavourOS (Arch-based), KDE on Wayland, webkit2gtk 4.1 present (2.52.6). The app
launches from the Tauri bundle under `tauri/src-tauri/target/release/bundle/`
(AppImage locally; installed `.deb`/`.rpm` payloads register the app).

## Testing notes

- **Rebuild webview assets before testing UI changes:** the Tauri shell serves
  `dist/` (vite output), not `src/mainview/` — run `bun run build:web` after
  editing UI sources. `bun run dev` serves from source with HMR instead.
- The SMOKE self-test driver (main-process RPC) was removed with Electrobun
  at M6; the contract is now covered by `platform.conformance` (fake) plus
  the Rust command tests.

## Known limitations

- Branch protection unavailable (GitHub Free, private repo) — see
  [`GIT_WORKFLOW.md`](../GIT_WORKFLOW.md) for compensating controls.
- Installer payload measured 34 MB at U0 vs the ≤ 20 MB budget — RESOLVED
  2026-09-15 (U8/RON-301): re-measured 35.0 MB, bun runtime = 97% of payload;
  owner-approved exception re-budgets installer to ≤ 40 MB, Cottontail
  migration trigger-armed.
