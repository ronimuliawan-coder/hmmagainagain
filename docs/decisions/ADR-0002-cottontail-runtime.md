# ADR-0002 — Main process runtime: dual-compatible, cutover deferred

Status: accepted (RON-315 Gate-2 review + owner decision 2026-09-23). Amends the
runtime sentence of [ADR-0001 C2](ADR-0001-stack.md); the git-engine choice
(subprocess git, argv arrays, porcelain, cat-file batch, write queue) is
unchanged.

## Context

U8 measured the Bun runtime at 97% of the 35 MB Linux payload against a
≤ 40 MB budget (≤ 20 MB aspiration) — arithmetically unreachable without a
runtime swap. Owner-approved exception, Cottontail migration trigger-armed
(`docs/GOVERNANCE.md` invariants).

## Decision

Shipped main code is dual-compatible (runs under Bun and Cottontail), but
`build.mainProcess` stays `"bun"` until the toolchain can package a
Cottontail main process on the stable channel.

## Evidence behind it

- P0 parity probes, all passing on Cottontail 0.5.0 AND 0.6.0
  (`/tmp/opencode/ct-probe.mjs`, rerunnable): piped stdout/stderr drains +
  exit codes, stdin write/end round-trip, SIGTERM kill (143/SIGTERM, same
  shape as Bun), env merge + cwd pinning, missing-cwd ENOENT (same message
  shape), recursive `node:fs.watch` burst delivery, streaming TextDecoder,
  AbortSignal identity.
- Full app boot + SMOKE `ok=true` under Cottontail 0.5.0 in the real app
  (status/tree/diff/log/scroll all live).
- The only port required: `git cat-file --batch` used the `FileSink` brand,
  absent under Cottontail. It now depends on a minimal structural stdin-sink
  shape (`write/flush/end`) satisfied by both runtimes; protocol logic
  untouched.

## Why deferred, not cut over

Stable packaging is blocked by a toolchain pairing skew (reproduced locally):
the hutch 0.26.0 builder demands 0.6.0-layout `bin/cottontail-core` while
stable Electrobun 2.0.1 pins app-runtime Cottontail 0.5.0 (whose layout
predates that file). `hutch upgrade stable` is a no-op, `electrobun update`
refuses with circular guidance, and the canary path (hutch canary +
Cottontail 0.7.0-canary.11) still refuses at `electrobun update` — moving to
canary Electrobun would drag the whole webview framework bleeding-edge, out
of proportion. Dev-channel Cottontail builds work (0.5.0 binary ships);
stable packaging does not.

## Re-arm conditions (any one)

- A stable toolchain state that packages a Cottontail main process
  (consistent builder + runtime pairing).
- Then: flip `build.mainProcess`, measure the packaged installer against
  budget, run the parity matrix + SMOKE, ship.

## Consequences

- Zero behavior change today: the gate still runs under toolchain Bun, the
  app still ships the Bun main process.
- Rollback of even this step = revert (dual-compatible code is inert).
- The U8 installer-budget exception stands until the re-arm conditions clear.
