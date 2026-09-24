---
description: "Autonomously triage, verify, fix, reply to, and resolve reviewer comments (CodeRabbit, Macroscope, Greptile) on open PRs"
argument-hint: "[pr-number | pr-url] (optional, defaults to active PR for current branch)"
---

# PR Review Remediation Workflow

Autonomously triage, verify, fix, reply to, and resolve reviewer comments from automated tools (CodeRabbit, Macroscope, Greptile) on GitHub pull requests with batching and settle-window protection.

**Input**: `$ARGUMENTS` — optional PR number (e.g. `71`), PR URL, or empty to auto-detect from current branch.

---

## Non-Negotiable Rules & Invariants

| Rule | Requirement | Why |
|---|---|---|
| **360-Degree Review Audit** | Automatically audit ALL 5 entry points on the PR: open threads, discussion replies, top-level reviews, nitpicks, and issue comments across all commits. | Comprehensive coverage without requiring the user to specify links or perspectives. |
| **Mandatory Attribution** | Every PR comment reply MUST end with:<br>`- AG-Ron` at the bottom | Transparency & informal sign-off attribution. |
| **Single Commit & Push** | Batch ALL fixes in a review cycle into **ONE single atomic commit** and push once. | Saves CI runner minutes and prevents triggering intermediate reviewer runs. |
| **Settle / Quiescence Window** | Always verify that all reviewer check-suites have completed before processing findings. | Prevents reviewing partial findings while another bot is mid-review. |
| **Never Resolve Threads Autonomously** | The assistant MUST NEVER resolve review threads/conversations. | Only the reviewers (human or AI) or Ron can resolve conversations/threads. |
| **Never Auto-Merge Promotion PRs** | Promotion PRs (`release/promote-dev-* -> main`) must NEVER be auto-merged by the assistant. | Ron merges promotion PRs manually once all checks are green. |

---

## Phase 1 — DISCOVER & SETTLE

### 1.1 Identify Target PR
Parse `$ARGUMENTS`:
- If number or URL provided, use it.
- If blank, auto-detect from active branch:
  ```bash
  gh pr view --json number,headRefName,baseRefName,headRefOid,state,title
  ```

### 1.2 Wait for Reviewer Quiescence (Settle Window)
Check the status of all automated reviewer suites for the PR's head commit:
```bash
node .agents/skills/pr-review-remediation/scripts/pr_review_tools.cjs suites <commit_sha>
```

- **If `allCompleted: false`**:
  Reviewers (`coderabbitai`, `MacroscopeApp`, `Greptile Apps`, `GitHub Actions`) are still processing.
  Schedule a 45–60s wait timer:
  ```
  Schedule one-shot timer: DurationSeconds=45, Prompt="Check reviewer suites status"
  ```
  Repeat until `allCompleted: true`.

- **If `allCompleted: true`**:
  All automated reviewers have settled. Proceed to extraction.

---

## Phase 2 — 360-DEGREE BATCH EXTRACTION

Fetch all review data across all PR entry points:
```bash
node .agents/skills/pr-review-remediation/scripts/pr_review_tools.cjs fetch <pr_number>
```

Parse and organize findings across all 5 surfaces:
1. **Pending Action & Inline Review Threads** (`pendingActionThreads` / `unresolvedThreads`): File path, line number, bot author, original comment, latest follow-up reply, and whether a response/fix is needed.
2. **Top-Level PR Reviews (`pullrequestreview-*`)** (`reviews`): Formal review submissions, overall statuses, and embedded findings.
3. **Bot Summaries & Outside Diff Comments** (`botSummaries`): Overall review reports and outside-diff suggestions.
4. **Collapsible Nitpicks**: Extracted collapsible `<details>` blocks from CodeRabbit / Macroscope comments.
5. **Commit-Specific & Range Diffs**: Review comments anchored to historical commits (`/changes/<sha>#r...`) and cumulative diffs (`/changes/BASE..<sha>#r...`).

If all findings are addressed, all discussions are replied to, and all check-suites are `success`, skip to **Phase 7 (Handoff)**.

---

## Phase 3 — CODEBASE VERIFICATION & PLAN

Before making any changes to files, verify each finding against live code.

### 3.1 Verification Checklist
For each finding:
1. **Does the line/code actually exist?** (Check for hallucinations or outdated line references).
2. **Is the reported problem valid?** (Trace callers, imports, transaction boundaries, and types).
3. **Is it already handled?** (Check if surrounding code or framework semantics already prevent the issue).

### 3.2 Plan Formulation
Draft a structured verification table in the following format and present it to Ron:

```markdown
### PR Review Findings & Plan for PR #<number>

| # | File / Location | Source | Issue Summary | Assessment | Proposed Action |
|---|---|---|---|---|---|
| 1 | `src/lib/...:L12` | CodeRabbit | ... | Valid | Apply fix: ... |
| 2 | `src/models/...:L45` | Macroscope | ... | Disagree / Rebuttal | Rebuttal: ... |
```

> **STOP**: Present the plan to Ron and obtain confirmation before modifying any codebase files.

---

## Phase 4 — UNIFIED IMPLEMENTATION & LOCAL VALIDATION

Once approved:
1. Apply all accepted fixes across all affected files together.
2. Run local test suite and quality gates:
   ```bash
   npm test && npm run typecheck && npm run lint
   ```
3. Ensure 100% tests pass and zero compiler/lint errors exist before staging.

---

## Phase 5 — SINGLE COMMIT & PUSH

Stage all modified files and create **one single atomic commit**:
```bash
git add <modified_files>
git commit -m "fix: resolve PR #<pr_number> review feedback across <components>

- <bullet point 1>
- <bullet point 2>"
git push origin <head_branch>
```

---

## Phase 6 — ATTRIBUTED REPLIES & TECHNICAL REBUTTALS

For every review thread:

1. **Post Attributed Reply**:
   - For valid issues that were fixed:
     ```bash
     node .agents/skills/pr-review-remediation/scripts/pr_review_tools.cjs reply <pr_number> <comment_id> "Verified and fixed: <explanation of fix applied>"
     ```
   - For false positives or out-of-scope feedback:
     ```bash
     node .agents/skills/pr-review-remediation/scripts/pr_review_tools.cjs reply <pr_number> <comment_id> "Technical rebuttal: <code-backed architectural explanation>"
     ```
   *(The script automatically appends the `- AG-Ron` sign-off signature at the bottom).*

2. **DO NOT resolve review threads**:
   Leave review threads open so that the original reviewer (e.g. CodeRabbit bot or human reviewer) or Ron can inspect the changes, post follow-ups, and resolve the thread.

---

## Phase 7 — MONITORING & FINAL HANDOFF

1. Loop back to **Phase 1** to wait for the new commit's check-suites and reviews to settle.
2. If new review comments are posted on the new commit, execute the next batched cycle (Phases 2–6).
3. Once all check-suites are `success` (green) and all review feedback is addressed:
   - Document changes in `walkthrough.md`.
   - Provide a concise summary to Ron.
   - **Do not merge promotion PRs** — leave for Ron to merge manually.
