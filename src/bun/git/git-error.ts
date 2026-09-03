// Unified git failure: every spawn or exit-code failure above becomes this, so
// callers handle one error type. stderr is verbatim from git when available.
// stdout is captured too because some git failures print on stdout (e.g.
// "no changes added to commit" from `git commit`).

export class GitError extends Error {
	constructor(
		message: string,
		public readonly stderr: string,
		public readonly exitCode: number | null,
		public readonly stdout = "",
	) {
		super(message);
		this.name = "GitError";
	}
}
