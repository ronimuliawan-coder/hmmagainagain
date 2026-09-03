// Generates a git fixture repo whose worktree diff is ~LINE_COUNT lines —
// the U4 budget-measurement fixture (RON-297). The script is committed; the
// repo it creates is throwaway (pass a scratch directory).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const target = process.argv[2];
const lineCount = Number(process.argv[3] ?? 1_000_000);
if (!target || !Number.isFinite(lineCount) || lineCount <= 0) {
	console.error("usage: bun scripts/make-diff-fixture.ts <dir> [lineCount]");
	process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });

const run = (args: string[]) => {
	const proc = Bun.spawnSync(["git", "-C", target, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (proc.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
	}
};

run(["init", "-q", "-b", "main"]);
// Baseline: one committed line, so the worktree diff is ~lineCount additions.
writeFileSync(join(target, "big.txt"), "baseline\n");
run(["add", "big.txt"]);
run([
	"-c",
	"user.name=fixture",
	"-c",
	"user.email=fixture@example.com",
	"commit",
	"-qm",
	"baseline",
]);

// Worktree change: exactly lineCount padded lines replacing the baseline.
const chunk = "const value = 1; // diff budget fixture line\n";
const fullChunks = Math.floor(lineCount / 10_000);
const remainder = lineCount % 10_000;
let contents = chunk.repeat(fullChunks);
if (remainder > 0) contents += chunk.repeat(remainder);
writeFileSync(join(target, "big.txt"), contents);

console.log(`fixture ready: ${target} (~${lineCount} changed lines)`);
