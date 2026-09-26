---
name: pr-review-remediation
description: "Autonomous end-to-end pull request review remediation workflow for code repositories. Gathers reviewer findings (CodeRabbit, Macroscope, Greptile), waits for reviewers to settle, batches fixes into a single atomic commit, tests locally, replies with informal sign-off attribution ('- AG-Ron'), and monitors CI until 100% green. Use when asked to 'check open PR comments', 'resolve PR reviews', 'triage PR reviews', or when running /resolve-pr-reviews."
---

# PR Review Remediation Workflow

An autonomous, resource-efficient workflow for evaluating, fixing, replying to, and remediating automated code reviewer comments (CodeRabbit, Macroscope, Greptile, etc.) on GitHub Pull Requests.

## Non-Negotiable Rules

1. **Comprehensive 360-Degree Entry Point Audit**:
   When notified that new comments or reviews have been posted, the assistant MUST automatically inspect **every possible entry point** on the PR without requiring the user to specify links or perspectives:
   - **Inline Review Threads**: Both open threads and threads with new follow-up replies on recent or historical commits.
   - **Discussion Replies**: Responses to previous fixes, explanations, or earlier `- AG-Ron` comments.
   - **Top-Level PR Reviews (`pullrequestreview-*`)**: Formal review submissions, overall statuses, and embedded findings.
   - **Collapsible `<details>` & Nitpicks**: Expandable sections within bot review summaries or inline comments.
   - **General Issue Comments (`issuecomment-*`)**: Top-level PR timeline comments and bot summaries.
   - **Commit-Specific & Range Diffs**: Comments attached to single commits (`/changes/<sha>#r...`) or cumulative diffs (`/changes/BASE..<sha>#r...`).
   Every finding from any entry point must receive the same rigorous, critical evaluation against live code.

2. **Informal Attribution Sign-off on All Comments**:
   Every PR comment reply MUST end with the signature at the bottom:

   ```markdown
   <explanation of fix or technical rebuttal>

   - AG-Ron
   ```

3. **Single Commit & Push per Batch Cycle**:
   Never commit or push incrementally for individual comments. Aggregate all accepted fixes across the entire batch (main comments, outside-diffs, nitpicks), run local verification across the combined diff, and commit & push **once** per review cycle.

4. **Explicit Reviewer Quiescence / Settle Window**:
   Before reading comments or formulating fixes, verify that all automated reviewer check-suites (`coderabbitai`, `MacroscopeApp`, `Greptile Apps`, `GitHub Actions`) on the latest commit have transitioned from `queued` / `in_progress` to `completed`. If any are still running, wait using a schedule timer (e.g. 45–60s) until they settle to ensure findings are reviewed in complete batches.

5. **Never Resolve Review Threads / Conversations Autonomously**:
   The assistant MUST NEVER resolve PR review threads or conversations. Only the reviewers (human or AI) or Ron can resolve conversations/threads. The assistant evaluates each comment, pushes code fixes for valid issues, or posts attributed technical rebuttals (with code/architectural evidence) if a comment is invalid, a false positive, or out of scope, allowing the reviewer or Ron to evaluate and resolve the thread.

6. **Never Auto-Merge Promotion PRs**:
   Promotion PRs (`release/promote-dev-* -> main`) must NEVER be merged by the assistant. The assistant brings the PR to 100% green (passing CI and all reviews addressed) and hands off to Ron for manual merge.

---

## Workflow Execution Lifecycle

### Phase 1: Wait for Reviewers to Settle (Quiescence Window)
Query the check suites on the current PR head commit:
```bash
node .agents/skills/pr-review-remediation/scripts/pr_review_tools.cjs suites <commit_sha>
```
- If `allCompleted` is `false`, schedule a timer (45–60 seconds) and wait.
- Proceed only when all automated reviewers have posted their findings for the current commit.

### Phase 2: 360-Degree Batch Extraction
Fetch all review threads, summaries, outside-diff suggestions, and nitpicks across all surfaces:
```bash
node .agents/skills/pr-review-remediation/scripts/pr_review_tools.cjs fetch <pr_number>
```
Extract and categorize:
- **Pending Action Threads** (`pendingActionThreads`): Unresolved threads and threads where the latest comment is a reviewer follow-up/question.
- **Top-Level PR Reviews** (`reviews`): Formal review submissions and approval states.
- **Bot Issue Comments** (`botSummaries`): Overall review reports and outside-diff suggestions.
- **Collapsible Nitpicks**: Extracted `<details>` sections.

### Phase 3: Codebase Verification & Planning
1. Verify every finding against actual source code to filter out false positives or obsolete remarks.
2. Formulate a structured plan:
   - **Valid Fixes**: Rationale and proposed code changes.
   - **Technical Rebuttals**: Evidence-based explanations (referencing source code, framework invariants, or architectural constraints) for why a suggestion is not applicable or is a false positive.
3. Present the plan to the user for confirmation before editing code.

### Phase 4: Unified Implementation & Local Testing
1. Apply all accepted fixes across all relevant files.
2. Run local verification suites:
   ```bash
   # Execute project quality gates (typecheck, lint, unit tests, build)
   npm test && npm run typecheck && npm run lint
   ```
3. Ensure all tests pass and zero compiler/lint errors exist before proceeding.

### Phase 5: Single Commit & Push
Stage and commit all changes in a single atomic commit:
```bash
git add <modified_files>
git commit -m "fix: resolve PR #<num> review feedback across <components>"
git push origin <head_branch>
```

### Phase 6: Attributed Replies & Technical Rebuttals
1. Post replies to each comment thread using the helper tool (which automatically appends the `- AG-Ron` sign-off signature at the bottom):
   - For fixes: `"Verified and fixed: <explanation of change>"`
   - For technical rebuttals: `"Technical rebuttal: <evidence-backed explanation>"`
   ```bash
   node .agents/skills/pr-review-remediation/scripts/pr_review_tools.cjs reply <pr_number> <comment_id> "<message>"
   ```
2. **DO NOT resolve review threads**: Leave review threads open so that the original reviewer (e.g. CodeRabbit bot or human reviewer) or Ron can inspect the changes, post follow-ups, and resolve the thread.

### Phase 7: Verification Loop & Final Handoff
1. Loop back to **Phase 1** to wait for the new commit's check-suites and bot reviews to settle.
2. If new comments arrive on the new commit, execute the next batched cycle (Phases 2–6).
3. Once all check-suites are `success` and all feedback is addressed:
   - Present a concise summary to the user.
   - Hand off to Ron for manual review and merge.
