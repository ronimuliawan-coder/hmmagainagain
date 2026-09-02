// Unified git failure: every spawn or exit-code failure above becomes this, so
// callers handle one error type. stderr is verbatim from git when available.

export class GitError extends Error {
	constructor(
		message: string,
		public readonly stderr: string,
		public readonly exitCode: number | null,
	) {
		super(message);
		this.name = "GitError";
	}
}
