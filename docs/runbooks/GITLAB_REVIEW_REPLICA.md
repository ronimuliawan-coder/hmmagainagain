# GitLab Review Replica Runbook

GitLab (`gitlab.com/ronimuliawan/hmmagainagain`) is a **review-only projection** of the
canonical GitHub repository. GitHub remains the only place where branches are authored,
pull requests are merged, and validation is trusted.

## Current status

| Item | State |
|---|---|
| Replica repository | Exists, private, `dev` and `master` pushed manually at each unit merge |
| Projection mechanism | Manual `git push gitlab` from the canonical repo (automation is a future item, not yet authorized) |
| Merge requests on GitLab | Never merged; if review bots are added later, their findings return to the originating GitHub PR |
| Credentials | Owner's GitLab account via HTTPS; no deploy keys or bot tokens configured yet |

## Authority and ref contract

| Ref or action | Authority | GitLab behavior |
|---|---|---|
| `master`, `dev` | GitHub (canonical) | Projected read-only; never edited or merged on GitLab |
| Unit branches (`ron-NNN-*`) | GitHub | May be pushed for review convenience; PRs happen on GitHub |
| Merges | GitHub only | GitLab merge requests must stay unmerged |
| Findings from GitLab-side review | Owner/agents | Applied as commits on the originating GitHub pull-request branch |

## Operations

- Push the projection after each merged unit: `git push gitlab master dev`.
- If the replica drifts or a push is rejected, re-project from canonical
  (`git fetch origin && git push gitlab origin/master:master origin/dev:dev` — a
  fast-forward by construction). Never rewrite replica refs with force.
- Decommissioning the replica has zero effect on the canonical repository.

## When this runbook changes

If a projection workflow, deploy key, or review bot is ever added, update this runbook in
the same change and record the decision in the Linear Evidence Log.
