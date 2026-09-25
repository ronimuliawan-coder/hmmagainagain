// Pure log-record parsing, engine-agnostic (moved from the Bun git
// engine at M6 cutover). The streaming log protocol shape lives here.

export interface LogCommit {
	oid: string;
	shortOid: string;
	authorName: string;
	authorEmail: string;
	date: string;
	subject: string;
	refs: string;
}

export const LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D%x00";

/**
 * Incremental parser: feed raw stdout chunks, receive complete commits in
 * order. Handles records split across chunk boundaries via a remainder buffer.
 */
export class LogRecordParser {
	private buffer = "";
	// Persistent streaming decoder: a multi-byte sequence split across pipe
	// reads must not decode to replacement characters (CodeRabbit U0–U8).
	private decoder = new TextDecoder();

	feed(chunk: Uint8Array): LogCommit[] {
		this.buffer += this.decoder.decode(chunk, { stream: true });
		const commits: LogCommit[] = [];
		let index = this.buffer.indexOf("\0");
		while (index !== -1) {
			// git log separates entries with a leading newline when the format
			// does not end with one — strip it (a record never starts with \n).
			let record = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 1);
			record = record.replace(/^\n/, "");
			if (record.trim().length > 0) {
				commits.push(parseCommitRecord(record));
			}
			index = this.buffer.indexOf("\0");
		}
		return commits;
	}

	/** Flush a final (unterminated) record — git closes stdout at exit. */
	flush(): LogCommit[] {
		// Drain any bytes the streaming decoder held back, then the buffer.
		this.buffer += this.decoder.decode();
		const rest = this.buffer;
		this.buffer = "";
		return rest.trim().length > 0 ? [parseCommitRecord(rest)] : [];
	}
}

function parseCommitRecord(record: string): LogCommit {
	const fields = record.split("\x1f");
	return {
		oid: fields[0] ?? "",
		shortOid: fields[1] ?? "",
		authorName: fields[2] ?? "",
		authorEmail: fields[3] ?? "",
		date: fields[4] ?? "",
		subject: fields[5] ?? "",
		refs: fields[6] ?? "",
	};
}
