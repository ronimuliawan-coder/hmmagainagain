# ADR-0002 — Main process runtime: Bun → Cottontail

Status: accepted (RON-315 Gate-2 review). Supersedes the runtime sentence of
[ADR-0001 C2](ADR-0001-stack.md) only; the git-engine choice (subprocess git,
argv arrays, porcelain, cat-file batch, write queue) is unchanged.

## Context

U8 measured the Bun runtime at 97% of the 35 MB Linux payload against a
≤ 40 MB budget (≤ 20 MB aspiration) — arithmetically unreachable without a
runtime swap. Owner-approved exception, Cottontail migration trigger-armed
(`docs/GOVERNANCE.md` invariants).

## Decision

Main process builds with Cottontail 0.6.0 (`electrobun.config.ts:
build.mainProcess: "cottontail"`, entrypoint unchanged at
`src/bun/index.ts`).

## Evidence behind it

- P0 parity probes, all passing on Cottontail 0.6.0 (`/tmp/opencode/ct-probe.mjs`,
  rerunnable): piped stdout/stderr drains + exit codes, stdin write/end
  round-trip, SIGTERM kill (143/SIGTERM, same shape as Bun), env merge + cwd
  pinning, missing-cwd ENOENT (same message shape), recursive `node:fs.watch`
  burst delivery, streaming TextDecoder, AbortSignal identity.
- The shipped main surface fits the compatible subset: `Bun.spawn` (pipes,
  kill, exit codes), named `spawn` from `"bun"`, `node:fs.watch`,
  TextDecoder, AbortController, timers, `process.env/cwd/exit`. No
  `Bun.sleep/file/serve`, no `node:path/os/child_process` in shipped code.
- One port required: `git cat-file --batch` used the `FileSink` brand, absent
  under Cottontail. It now depends on a minimal structural stdin-sink shape
  (`write/flush/end`) satisfied by both runtimes; protocol logic untouched.

## Consequences

- Shipped main code stays importable under both runtimes (compatible subset
  only — no Cottontail-only imports). The gate still runs under toolchain Bun;
  Cottontail parity is proven by the SMOKE self-test against a real fixture.
- Rollback = revert to `mainProcess: "bun"` (single commit).
- Open until measured: packaged Cottontail installer size vs budget. Nothing
  about this ADR claims it — Gate-2 exit criterion 4.
- Devkit pin still reads Cottontail 0.5.0 (toolchain-managed `.hutch/`,
  gitignored); builds use installed 0.6.0.
