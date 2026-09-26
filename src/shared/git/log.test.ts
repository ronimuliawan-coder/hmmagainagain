// Unit tests for incremental log parsing: records split across pipe
// reads — including multi-byte sequences — must reassemble exactly
// (CodeRabbit follow-up round; complements the decodeChunks suite).
import { describe, expect, test } from "bun:test";
import { LOG_FORMAT, LogRecordParser } from "./log-parse";

const enc = new TextEncoder();
const FS = "\x1f";

function record(subject: string): string {
	return ["oid1", "sh1", "Au", "au@t", "2026-01-01", subject, ""].join(FS);
}

describe("LogRecordParser", () => {
	test("wire format matches the parser contract", () => {
		expect(LOG_FORMAT).toContain("%x1f");
		expect(LOG_FORMAT.endsWith("%x00")).toBe(true);
	});

	test("feeds split at every byte offset reassemble", () => {
		const wire = `${record("ünïcödé 😀 subject")}\0`;
		const full = enc.encode(wire);
		for (let at = 1; at < full.length; at++) {
			const parser = new LogRecordParser();
			const head = parser.feed(full.slice(0, at));
			const tail = parser.feed(full.slice(at));
			const flushed = parser.flush();
			const subjects = [...head, ...tail, ...flushed].map((c) => c.subject);
			expect(subjects).toEqual(["ünïcödé 😀 subject"]);
		}
	});

	test("flush emits the unterminated tail record", () => {
		const parser = new LogRecordParser();
		expect(parser.feed(enc.encode(`${record("no-nul-yet")}`))).toEqual([]);
		expect(parser.flush().map((c) => c.subject)).toEqual(["no-nul-yet"]);
		expect(parser.flush()).toEqual([]);
	});
});
