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
4. Toolchain check: `bun --version` (1.4.0), `hutch --version` (0.26.0 via
   `~/.hutch/bin` — wired by a PATH line in `~/.bashrc`; installer:
   `curl -fsSL https://hutch.blackboard.sh/hutch/install.sh | sh`), Electrobun pinned **2.0.1** in
   `hutch.config.ts`, provisioned by `hutch electrobun prepare` into `./.hutch/devkit`
   (gitignored). If only `~/.hutch/bin` is missing but `~/.hutch` still exists, do not
   rerun the installer (it refuses a pre-existing `~/.hutch`); if `~/.hutch` is entirely
   absent, a fresh install is safe and required (done 2026-09-15).
5. `bun run install:deps` if `node_modules` is missing, then `bun run check` — must be
   green before any change.
6. Reference clone `/home/ron/Projects/pierre` is read-only; if missing, it is optional —
   re-clone only if the active unit needs Pierre API recon.

## Machine profile (primary dev machine)

EndeavourOS (Arch-based), KDE on Wayland, webkit2gtk 4.1 present (2.52.6). The app
launches from `build/<env>-linux-x64/hmmagainagain/bin/launcher`, which self-extracts to
`~/.local/share/dev.hmmagainagain.app/<env>/app`.

## Testing notes

- **After `bun run build`, refresh the installed app before testing**: run the build
  directory launcher (`build/<env>-linux-x64/hmmagainagain/bin/launcher`) once — it
  re-extracts into `~/.local/share/dev.hmmagainagain.app/`. The installed launcher then
  runs the NEW build; skipping this step silently tests a stale bundle.
- SMOKE_STAGE / SMOKE_BRANCH flows mutate their target repository — point `SMOKE_ROOT`
  at a throwaway fixture only.

## Known limitations

- Branch protection unavailable (GitHub Free, private repo) — see
  [`GIT_WORKFLOW.md`](../GIT_WORKFLOW.md) for compensating controls.
- Installer payload measured 34 MB at U0 vs the ≤ 20 MB budget — open watch-item owned by
  U8 ([RON-301](https://linear.app/rons-space/issue/RON-301)).
