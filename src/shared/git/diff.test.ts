// A1 differential proof: patch-derived stats must agree with real
// `git diff --numstat` on every fixture flavor (regular, rename, binary,
// CRLF, unicode names, mode-only, empty). The tiny numstat parser below is
// deliberately test-local: production keeps exactly one stats path.
import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DiffFile, parsePatchStats, unquotePath } from "./diff-parse";

const base = mkdtempSync(join(tmpdir(), "hmmagainagain-a1-"));
const ENV = {
	GIT_AUTHOR_NAME: "A1",
	GIT_AUTHOR_EMAIL: "a1@fixture.test",
	GIT_COMMITTER_NAME: "A1",
	GIT_COMMITTER_EMAIL: "a1@fixture.test",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
};

afterAll(() => {
	rmSync(base, { recursive: true, force: true });
});

function g(dir: string, ...args: string[]): string {
	return execFileSync("git", ["-C", dir, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...ENV },
	});
}

function initRepo(name: string): string {
	const dir = join(base, name);
	mkdirSync(dir, { recursive: true });
	g(dir, "init", "-q", "-b", "main");
	// Local identity: the differential shell-outs below carry env identity,
	// but adapter-equivalent paths must not depend on ambient git config.
	g(dir, "config", "user.email", "fixture@example.test");
	g(dir, "config", "user.name", "fixture");
	return dir;
}

function commitAll(dir: string, message: string): void {
	g(dir, "add", "-A");
	g(dir, "commit", "-qm", message);
}

const num = (v: string | undefined): number =>
	v === "-" ? -1 : Number(v ?? 0);

/** Minimal test-local numstat reader (see header note). */
function numstatFiles(dir: string): DiffFile[] {
	const raw = g(dir, "diff", "--numstat", "-z", "--no-color");
	const recs = raw.split("\0");
	const out: DiffFile[] = [];
	let i = 0;
	while (i < recs.length) {
		const record = recs[i++];
		if (!record) continue;
		const [add, del, path] = record.split("\t");
		if (path === "") {
			const orig = recs[i++];
			const next = recs[i++];
			if (orig === undefined || next === undefined) continue;
			out.push({
				path: next,
				renamedFrom: orig,
				additions: num(add),
				deletions: num(del),
				binary: add === "-",
			});
		} else {
			out.push({
				path: path ?? "",
				additions: num(add),
				deletions: num(del),
				binary: add === "-",
			});
		}
	}
	return out;
}

const byPath = (files: DiffFile[]): DiffFile[] =>
	[...files].sort((a, b) => (a.path < b.path ? -1 : 1));

/** Assert patch-derived stats equal live numstat, same traversal order. */
function expectParity(dir: string): void {
	const patch = g(dir, "diff", "--no-color");
	expect(byPath(parsePatchStats(patch))).toEqual(byPath(numstatFiles(dir)));
}

describe("parsePatchStats differential vs git numstat", () => {
	test("regular modification", async () => {
		const dir = initRepo("regular");
		writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
		commitAll(dir, "base");
		writeFileSync(join(dir, "a.txt"), "one\nTWO\nthree\n");
		expectParity(dir);
	});

	test("rename with modifications", async () => {
		const dir = initRepo("rename");
		writeFileSync(join(dir, "old.txt"), "same\n");
		commitAll(dir, "base");
		execFileSync("git", ["-C", dir, "mv", "old.txt", "new.txt"]);
		writeFileSync(join(dir, "new.txt"), "same\nchanged\n");
		expectParity(dir);
	});

	test("binary add and modify", async () => {
		const dir = initRepo("binary");
		writeFileSync(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3]));
		commitAll(dir, "base");
		writeFileSync(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3, 4, 5]));
		writeFileSync(join(dir, "new.bin"), Buffer.from([9, 9, 9]));
		execFileSync("git", ["-C", dir, "add", "-A"]);
		expectParity(dir);
	});

	test("CRLF content", async () => {
		const dir = initRepo("crlf");
		writeFileSync(join(dir, "dos.txt"), "a\r\nb\r\n");
		commitAll(dir, "base");
		writeFileSync(join(dir, "dos.txt"), "a\r\nB\r\nc\r\n");
		expectParity(dir);
	});

	test("unicode paths", async () => {
		const dir = initRepo("unicode");
		writeFileSync(join(dir, "ünïcödé 😀.txt"), "v1\n");
		commitAll(dir, "base");
		writeFileSync(join(dir, "ünïcödé 😀.txt"), "v1\nv2\n");
		expectParity(dir);
	});

	test("paths with spaces (b-side tokenizing trap)", async () => {
		const dir = initRepo("spaces");
		writeFileSync(join(dir, "staged new file.txt"), "v1\n");
		commitAll(dir, "base");
		writeFileSync(join(dir, "staged new file.txt"), "v1\nv2\n");
		expectParity(dir);
	});

	test("mode-only change yields zero counts", async () => {
		const dir = initRepo("mode");
		writeFileSync(join(dir, "run.sh"), "x\n");
		commitAll(dir, "base");
		execFileSync("git", ["-C", dir, "update-index", "--chmod=+x", "run.sh"]);
		expectParity(dir);
	});

	test("empty diff yields no files", async () => {
		const dir = initRepo("empty");
		writeFileSync(join(dir, "a.txt"), "x\n");
		commitAll(dir, "base");
		expectParity(dir);
	});
});

describe("unquotePath", () => {
	test("bare paths pass through", () => {
		expect(unquotePath("a/plain file.txt")).toBe("a/plain file.txt");
	});

	test("quoted octal decodes to UTF-8", () => {
		expect(unquotePath('"a/\\303\\274nic\\303\\266d\\303\\251.txt"')).toBe(
			"a/ünicödé.txt",
		);
		expect(unquotePath('"b/\\360\\237\\230\\200.txt"')).toBe("b/😀.txt");
	});
});

describe("parsePatchStats", () => {
	test("empty patch yields no files", () => {
		expect(parsePatchStats("")).toEqual([]);
	});
});
