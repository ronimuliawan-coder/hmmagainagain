#!/usr/bin/env node

/**
 * Project-Agnostic PR Review Remediation Tools
 *
 * Provides automated helpers for:
 * 1. Dynamically discovering repository owner and name from git / gh context (safe from shell injection)
 * 2. Waiting for all automated reviewers (CodeRabbit, Macroscope, Greptile) and CI check-suites to settle
 * 3. Fetching all unresolved review threads, bot summaries, outside diffs, and nitpicks
 * 4. Posting replies with informal sign-off attribution ("- AG-Ron") at the bottom
 * 5. Resolving review threads via GitHub GraphQL
 */

const { execFileSync } = require("child_process");

const ATTRIBUTION_SIGN_OFF = "\n\n- AG-Ron";

const RELEVANT_APPS = [
	"coderabbitai",
	"MacroscopeApp",
	"Greptile Apps",
	"GitHub Actions",
	"Vercel",
	"Netlify",
	"Blacksmith",
	"CircleCI",
];

const ALLOWED_BOT_LOGINS = new Set([
	"coderabbitai",
	"coderabbitai[bot]",
	"macroscopeapp",
	"macroscopeapp[bot]",
	"greptile",
	"greptile[bot]",
	"greptile-apps[bot]",
]);

const REPO_IDENTIFIER_REGEX = /^[a-zA-Z0-9_.-]+$/;

function validateRepoIdentifier(val, label) {
	if (
		!val ||
		typeof val !== "string" ||
		!REPO_IDENTIFIER_REGEX.test(val.trim())
	) {
		throw new Error(`Invalid repository ${label}: "${val}"`);
	}
	return val.trim();
}

/**
 * Dynamically resolve the GitHub repository owner and name without shell interpolation.
 */
function getRepoInfo() {
	try {
		const raw = execFileSync("gh", ["repo", "view", "--json", "owner,name"], {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		});
		const info = JSON.parse(raw || "{}");
		if (info.name && info.owner?.login) {
			return {
				owner: validateRepoIdentifier(info.owner.login, "owner"),
				name: validateRepoIdentifier(info.name, "name"),
			};
		}
	} catch {
		// Fallback: parse git remote origin URL
	}

	try {
		const remote = execFileSync(
			"git",
			["config", "--get", "remote.origin.url"],
			{
				encoding: "utf8",
				stdio: ["pipe", "pipe", "ignore"],
			},
		).trim();
		const match = remote.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
		if (match) {
			return {
				owner: validateRepoIdentifier(match[1], "owner"),
				name: validateRepoIdentifier(match[2], "name"),
			};
		}
	} catch {
		// Fallback failure
	}

	throw new Error(
		"Unable to automatically determine repository owner and name. Ensure `gh` or `git remote` is configured.",
	);
}

const { owner: REPO_OWNER, name: REPO_NAME } = getRepoInfo();

function runGh(args, input) {
	const options = { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 };
	if (input !== undefined) {
		options.input = typeof input === "string" ? input : JSON.stringify(input);
	}
	return execFileSync("gh", args, options);
}

function runGhJson(args, input) {
	const res = runGh(args, input);
	return JSON.parse(res || "{}");
}

/**
 * Check if all automated review check-suites and CI have finished running for a given commit.
 */
function checkSuitesStatus(commitSha) {
	const data = runGhJson([
		"api",
		`repos/${REPO_OWNER}/${REPO_NAME}/commits/${commitSha}/check-suites`,
		"--paginate",
	]);
	const suites = Array.isArray(data)
		? data.flatMap((d) => d.check_suites || [])
		: data.check_suites || [];

	const monitored = suites.filter(
		(s) =>
			s.app &&
			RELEVANT_APPS.some((app) =>
				s.app.name?.toLowerCase().includes(app.toLowerCase()),
			),
	);

	const pending = monitored.filter((s) => s.status !== "completed");
	return {
		repo: `${REPO_OWNER}/${REPO_NAME}`,
		allCompleted: monitored.length > 0 && pending.length === 0,
		total: monitored.length,
		pending: pending.map((s) => ({
			app: s.app?.name,
			status: s.status,
			conclusion: s.conclusion,
		})),
		completed: monitored
			.filter((s) => s.status === "completed")
			.map((s) => ({ app: s.app?.name, conclusion: s.conclusion })),
	};
}

/**
 * Fetch all review data for a pull request across all entry points:
 * 1. Inline review threads (open and resolved with follow-ups)
 * 2. Top-level Pull Request Reviews (pullrequestreview-*)
 * 3. Issue comments / bot summaries (issuecomment-*)
 * 4. Discussion replies and follow-ups
 */
function fetchPRReviewData(prNumber) {
	const query = `
    query($owner: String!, $repo: String!, $pull_number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pull_number) {
          id
          number
          title
          headRefOid
          headRefName
          baseRefName
          state
          reviews(first: 100) {
            nodes {
              id
              databaseId
              state
              submittedAt
              url
              author { login }
              body
            }
          }
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              resolvedBy { login }
              comments(first: 50) {
                nodes {
                  id
                  databaseId
                  url
                  author { login }
                  body
                  path
                  line
                  createdAt
                }
              }
            }
          }
        }
      }
    }
  `;

	const formattedQuery = query.replace(/\s+/g, " ").trim();
	const res = runGhJson([
		"api",
		"graphql",
		"-f",
		`query=${formattedQuery}`,
		"-F",
		`owner=${REPO_OWNER}`,
		"-F",
		`repo=${REPO_NAME}`,
		"-F",
		`pull_number=${prNumber}`,
	]);
	const pr = res.data?.repository?.pullRequest;

	if (!pr) {
		throw new Error(
			`Could not find PR #${prNumber} in ${REPO_OWNER}/${REPO_NAME}`,
		);
	}

	// Also fetch issue comments for CodeRabbit / top-level bot summaries
	let issueComments = [];
	try {
		issueComments = runGhJson([
			"api",
			`repos/${REPO_OWNER}/${REPO_NAME}/issues/${prNumber}/comments`,
			"--paginate",
		]);
	} catch (err) {
		console.warn(
			`[WARN] Failed to fetch issue comments for PR #${prNumber} (transient GitHub API error):`,
			err?.message,
		);
	}

	const allThreads = (pr.reviewThreads.nodes || []).map((t, idx) => {
		const comments = t.comments.nodes || [];
		const firstComment = comments[0] || {};
		const latestComment = comments[comments.length - 1] || {};
		const latestAuthor = latestComment.author?.login || "unknown";
		const latestBody = latestComment.body || "";
		const hasUnansweredReviewerComment = !latestBody
			.trim()
			.endsWith("- AG-Ron");

		return {
			index: idx + 1,
			threadId: t.id,
			isResolved: t.isResolved,
			resolvedBy: t.resolvedBy?.login || null,
			firstCommentId: firstComment.databaseId,
			latestCommentId: latestComment.databaseId,
			commentId: latestComment.databaseId || firstComment.databaseId,
			author: firstComment.author?.login,
			path: firstComment.path,
			line: firstComment.line,
			url: latestComment.url || firstComment.url,
			firstCommentBody: firstComment.body,
			latestAuthor,
			latestCommentDate: latestComment.createdAt,
			latestCommentBody: latestBody,
			hasUnansweredReviewerComment,
			allComments: comments,
		};
	});

	const unresolvedThreads = allThreads.filter((t) => !t.isResolved);
	const pendingActionThreads = allThreads.filter(
		(t) => t.hasUnansweredReviewerComment,
	);

	return {
		repo: `${REPO_OWNER}/${REPO_NAME}`,
		prNumber: pr.number,
		headSha: pr.headRefOid,
		headBranch: pr.headRefName,
		baseBranch: pr.baseRefName,
		state: pr.state,
		totalThreads: allThreads.length,
		unresolvedCount: unresolvedThreads.length,
		pendingActionCount: pendingActionThreads.length,
		unresolvedThreads,
		pendingActionThreads,
		allThreads,
		reviews: (pr.reviews.nodes || []).map((r) => ({
			id: r.id,
			databaseId: r.databaseId,
			author: r.author?.login,
			state: r.state,
			submittedAt: r.submittedAt,
			url: r.url,
			body: r.body,
		})),
		botSummaries: (Array.isArray(issueComments) ? issueComments : [])
			.filter((c) => {
				const login = c.user?.login?.toLowerCase();
				return login ? ALLOWED_BOT_LOGINS.has(login) : false;
			})
			.map((c) => ({
				id: c.id,
				author: c.user?.login,
				createdAt: c.created_at,
				updatedAt: c.updated_at,
				body: c.body,
			})),
	};
}

/**
 * Reply to a PR comment with informal attribution sign-off at the bottom.
 */
function replyToComment(prNumber, commentId, message) {
	const trimmed = message.trim();
	const fullBody = trimmed.endsWith("- AG-Ron")
		? trimmed
		: `${trimmed}${ATTRIBUTION_SIGN_OFF}`;

	runGh(
		[
			"api",
			`repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/comments/${commentId}/replies`,
			"--input",
			"-",
		],
		{ body: fullBody },
	);
	console.log(
		`[OK] Replied to comment ${commentId} in ${REPO_OWNER}/${REPO_NAME}`,
	);
}

/**
 * Resolve a review thread using GitHub GraphQL (manual/administrative utility).
 */
function resolveThread(threadId) {
	const query =
		"mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }";
	runGh([
		"api",
		"graphql",
		"-f",
		`query=${query}`,
		"-F",
		`threadId=${threadId}`,
	]);
	console.log(`[OK] Resolved thread ${threadId}`);
}

/**
 * Unresolve a review thread using GitHub GraphQL.
 */
function unresolveThread(threadId) {
	const query =
		"mutation($threadId: ID!) { unresolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }";
	runGh([
		"api",
		"graphql",
		"-f",
		`query=${query}`,
		"-F",
		`threadId=${threadId}`,
	]);
	console.log(`[OK] Unresolved thread ${threadId}`);
}

// CLI Command Router
const [, , command, ...args] = process.argv;

switch (command) {
	case "repo": {
		console.log(
			JSON.stringify({ owner: REPO_OWNER, name: REPO_NAME }, null, 2),
		);
		break;
	}
	case "suites": {
		const sha = args[0] || "HEAD";
		const status = checkSuitesStatus(sha);
		console.log(JSON.stringify(status, null, 2));
		break;
	}
	case "fetch": {
		const prNumber = parseInt(args[0], 10);
		if (!prNumber) {
			console.error("Usage: pr_review_tools.cjs fetch <pr_number>");
			process.exit(1);
		}
		const data = fetchPRReviewData(prNumber);
		console.log(JSON.stringify(data, null, 2));
		break;
	}
	case "reply": {
		const prNumber = parseInt(args[0], 10);
		const commentId = parseInt(args[1], 10);
		const message = args.slice(2).join(" ");
		if (!prNumber || !commentId || !message) {
			console.error(
				"Usage: pr_review_tools.cjs reply <pr_number> <comment_id> <message>",
			);
			process.exit(1);
		}
		replyToComment(prNumber, commentId, message);
		break;
	}
	case "resolve": {
		const threadId = args[0];
		if (!threadId) {
			console.error("Usage: pr_review_tools.cjs resolve <thread_id>");
			process.exit(1);
		}
		resolveThread(threadId);
		break;
	}
	case "unresolve": {
		const threadId = args[0];
		if (!threadId) {
			console.error("Usage: pr_review_tools.cjs unresolve <thread_id>");
			process.exit(1);
		}
		unresolveThread(threadId);
		break;
	}
	default:
		console.log(
			"Usage: pr_review_tools.cjs [repo | suites <commit_sha> | fetch <pr_number> | reply <pr_number> <comment_id> <msg> | resolve <thread_id> | unresolve <thread_id>]",
		);
}
