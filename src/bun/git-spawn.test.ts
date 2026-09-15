// Unit tests for decodeChunks: split multi-byte sequences must survive
// chunk boundaries without a joined patch-sized buffer (CodeRabbit
// follow-up on the 1M-line/46 MB load).
import { describe, expect, test } from "bun:test";
import { decodeChunks } from "./git-spawn";

const enc = new TextEncoder();

describe("decodeChunks", () => {
	test("empty input decodes to empty string", () => {
		expect(decodeChunks([])).toBe("");
	});

	test("single chunk decodes directly", () => {
		expect(decodeChunks([enc.encode("hello\n")])).toBe("hello\n");
	});

	test("multi-byte sequence split across chunks is preserved", () => {
		const full = enc.encode("a😀b ünïcödé c\n");
		// Split at every byte offset around the emoji and umlauts; every
		// split must round-trip exactly.
		for (let at = 1; at < full.length; at++) {
			expect(decodeChunks([full.slice(0, at), full.slice(at)])).toBe(
				"a😀b ünïcödé c\n",
			);
		}
	});

	test("chunk order is preserved", () => {
		expect(
			decodeChunks([enc.encode("two "), enc.encode("one ")].reverse()),
		).toBe("one two ");
	});
});
