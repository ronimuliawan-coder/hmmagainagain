# PRD — hmmagainagain (Desktop Git Client)

**Status: APPROVED 2026-09-03 by the approval owner (Ron).** The Linear project
["hmmagainagain"](https://linear.app/rons-space/project/hmmagainagain-a0a2aa5c25e3)
(Evidence Log + per-unit issues) is the live status record; this file is the in-repo
canonical copy of the approved product requirements. Supersede by new committed version +
Linear record; never rewrite in place.

## 1. Problem statement and cost of inaction

Developers need to inspect, stage, commit, and review changes in local git repositories.
On Linux, the fastest native clients don't exist (Fork is Windows/macOS only); cross-platform
clients are heavy (GitKraken is resource-heavy and sluggish on 100k+ commit repos) or
paid/proprietary (Sublime Merge $99); TUI options (lazygit) are fast but visually limited
for diff review; and the best diff-rendering experience available today — Pierre's
diffshub — is web-only and bound to GitHub URLs. Cost of inaction: daily workflow friction
for the primary user, and a standing open-source gap: no free, lightweight, cross-platform
git client with Pierre-grade diff rendering and Linux support.

## 2. Evidence and assumptions

**Evidence (sourced 2026-09-03):** github.com/pierrecomputer/pierre — Apache-2.0, 6.1k
stars, 1,226 commits, active; npm: @pierre/diffs 1.3.6 (Shiki-based, Shadow DOM,
virtualized), @pierre/trees 1.0.0-beta.6 (Preact-based, beta); diffshub demonstrates
million-line diff rendering in-browser via virtualization; market comparisons (Feb–Jun
2026): performance leaders Fork/Sublime Merge are proprietary and/or lack Linux; free
cross-platform options are Electron-heavy or TUI.

**Assumptions (founder-driven, to be validated):** A1 daily dogfooding by the founder is a
valid proxy for target users; A2 a web-component UI in a thin native shell can meet the
performance budgets (proven or refuted at U4/U8); A3 Apache-2.0 embedding obligations are
acceptable; A4 local-first host-agnostic behavior satisfies the primary user's remote
needs.

## 3. Users, context, trigger, job to be done, non-users

- **Primary user:** Ron — developer on EndeavourOS (Arch-based Linux), working across
  multiple personal git repositories daily.
- **Trigger/context:** returning to a repo to see what changed, review changes (own or
  AI-generated), stage, commit, push, browse history.
- **Job to be done:** "When I return to a repo, help me see what changed and ship it
  correctly in seconds, without dropping to the terminal."
- **Secondary users (deferred):** Windows/macOS developers wanting a lightweight client.
- **Non-users:** teams needing hosted review/PR workflows (diffshub serves that on the
  web); CI/automation (plain git CLI); users needing deep host integrations in v1.

## 4. Current alternatives and market research

| Alternative | Gap vs. this product |
|---|---|
| Fork | Fastest native client ($49.99), **no Linux build** |
| GitKraken | Cross-platform + beautiful graph, but resource-heavy, slow on huge repos, subscription |
| Sublime Merge | Instant startup, but $99 proprietary; minimalist graph view |
| lazygit | Free and fast, but TUI — limited diff visual experience |
| GitButler | Free/open (FSL-1.1-MIT), Electron-based, virtual-branches philosophy ≠ simple core git |
| GitHub Desktop | Free, simple, **no Linux**, limited features |
| diffshub.com | Pierre-grade rendering, but **web-only and GitHub-URL-bound** |

**Gap:** no free/open, lightweight, cross-platform desktop client combining Pierre-grade
diff UX with Linux support.

## 5. Vision, proposed capability, key hypothesis

**Vision:** "diffshub on your desktop — for any repo, offline."
**Capability:** a local desktop app combining @pierre/trees (repo file tree), @pierre/diffs
(best-in-class diff rendering), and a local git engine behind a thin native shell.
**Key hypothesis:** pairing Pierre's rendering components with a small native shell and
local git engine yields a client that is simultaneously lighter *and* more visually
excellent than any current cross-platform client. Validated if the founder dogfoods it as
primary client for ≥ 2 weeks with faster repo-review loops than his current tool mix.

## 6. Success metrics (profile: Ron's EndeavourOS machine; scripted benchmark + manual check)

| Metric | Target |
|---|---|
| Installer size (Linux) | ≤ 20 MB (per-OS profiles documented at U8) |
| Cold start | ≤ 300 ms |
| Idle RAM | ≤ 150 MB |
| Scroll performance | 1M-line diff without perceptible jank |
| Correctness | Zero user-data-loss incidents; git-operation test suite green on all 3 OSes; destructive ops require explicit confirmation |
| Adoption signal | Founder uses it daily as primary client for ≥ 2 weeks |

## 7. Minimum scope and prioritized capabilities

- **MUST (v1):** open/browse local repo · file tree · status · stage/unstage (file + hunk)
  · commit · diff (worktree↔HEAD, any two commits) · history browse · branch switch/create
  · push/pull.
- **SHOULD:** keyboard-first navigation; light/dark themes; repo picker with recents.
- **COULD (post-v1 candidates):** line-level staging; blame view; in-app content search.

## 8. Explicit non-goals (v1) and deferred work

Non-goals: interactive/plain rebase, cherry-pick, stash, conflict-resolution UI, remote
configuration, host integrations (GitHub/GitLab/PRs), multi-repo workspaces, mobile.
Deferred: all of the above plus Windows/macOS distribution polish (build targets exist;
signing/store packaging later).

## 9. Critical user/operational flow

Launch → repo picker (recents) → main view: file tree (left) + changed-file status →
click file → rendered diff → stage file or hunk → write message → commit → push.
Secondary: history → select any two commits → diff.
Operational invariants: the app never mutates repository state without an explicit user
action; git failures are surfaced verbatim with recovery hints; app crash/rollback never
damages user repository data.

## 10. Technical feasibility, integration context, risks, open questions

**Feasibility:** Both Pierre components are web-technology based (Shadow DOM / Preact),
hosted in Electrobun's system-webview shell; diffshub proves the rendering approach at
million-line scale. The stack decision record (with alternatives and the Tauri fallback)
lives in `docs/decisions/ADR-0001-stack.md`.
**Integration context:** v1 touches local filesystem only; network access limited to git
push/pull transport.
**Risks:** R1 component maturity (trees beta + preact-11-beta dep — pin + wrapper);
R2 Linux webview variance vs installer budget; R3 huge-repo performance (git-engine
benchmarks at U2/U4); R4 macOS signing / Windows distribution cost deferred to their
owning units.
**Open questions:** Q1 exact standalone-embedding APIs — resolved at Phase 1 recon via
the Pierre monorepo skills/docs; Q2 @pierre/theme coverage of theming needs (U3);
Q3 git-engine performance (U2/U4 benchmarks); Q4 per-platform window/OS integration
approach.

## 11. Provisional implementation phases (dependencies only — executed unit by unit)

U0 intake/scaffold ✅ → U1 platform adapter & RPC → U2 GitAdapter read paths → U3 UI shell
(tree/status) → U4 diff view → U5 staging/commit → U6 history/branches → U7 push/pull →
U8 budgets + Linux packaging. Windows/macOS distribution, auto-update, and PRD §7 COULD
items are post-v1. Each unit gate requires explicit owner confirmation.

## 12. Decisions and alternatives considered

- D1: Use Pierre's actual open-source components — alternatives rejected: inspired-by
  reimplementation (higher cost, loses proven UX), web app (not desktop/local).
- D2: Host-agnostic plain-git-first — alternative rejected: GitHub-integration-first.
- D3: Tracker = Linear; golden-standard governance conventions from the owner's
  `wandernest` repository.
- D4: v1 scope and budgets approved at Gate 0; TS end-to-end constraint added at Gate 2.
- D5: Stack (Gate 2): Electrobun 2.0.1 + subprocess git (Bun streaming adapter) + vanilla
  TypeScript — full conflict review in `docs/decisions/ADR-0001-stack.md`.

## 13. Validation status and recommended next evidence

**Status:** Approved (2026-09-03). Recommended next evidence per unit is recorded in the
unit's Linear issue; live status in the GOVERNANCE unit table.
