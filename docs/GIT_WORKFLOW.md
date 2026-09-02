# Git Workflow

How branches, merges, and pushes work in this repository, and which parts break things if
done differently. Most of this is ordinary; three things are not:

1. Pull requests **must** be merged with "Create a merge commit". Squash and rebase
   silently destroy the fast-forward property the `dev`↔`master` sync rests on. Both are
   disabled in repository settings.
2. `dev` is **fast-forwarded back to `master` after a promotion**, automatically. `dev` is
   not a long-lived divergent branch; it is a staging area repeatedly brought back to
   parity. Until the first release artifact (unit U8), no promotions exist and `master`
   simply mirrors `dev`.
3. **GitHub is the only write and merge authority.** GitLab is a review-only projection;
   its merge requests are never merged, and review findings return to the originating
   GitHub pull request ([runbook](runbooks/GITLAB_REVIEW_REPLICA.md)).

## The shape

```mermaid
graph LR
  B[feat/fix/docs ron-NNN branch] -->|PR| D[dev]
  B2[feat/fix/docs ron-NNN branch] -->|PR| D
  D -->|promotion PR, batched (from U8)| M[master]
  M -.->|automatic fast-forward| D
  D -.->|review-only projection| GL[GitLab replica]
  M -.->|review-only projection| GL
```

`master` is the default branch. `dev` is where day-to-day unit work lands. Batches of
`dev` are promoted to `master` through a single promotion pull request.

## The invariant

> `dev` always contains `master`. After a promotion merge, with no new work on `dev`
> since, the two point at the **same commit**.

After anything lands on `master`, the sync workflow brings `dev` back up to it. In the
promotion case that is a fast-forward leaving both branches equal; if `dev` moved on while
a promotion was open, the sync merges `master` into `dev` instead — nothing is ever forced
or discarded. Verify parity at any time:

```bash
git fetch origin && git rev-parse origin/master origin/dev
```

## Branch naming

`<type>/ron-<NNN>-<slug>` where `<type>` is `feat`, `fix`, or `docs`, and `ron-<NNN>` is
the Linear issue for the unit or task (e.g. `docs/ron-293-governance-alignment`). Every
unit has exactly one Linear issue; every PR references it.

## Protection status (honest note)

Branch protection rules require GitHub Pro for private repositories and are **not
currently enabled**. The compensating controls are: squash/rebase merges disabled in
repository settings, the no-force design of the sync workflow, and the rules in
[`AGENTS.md`](../AGENTS.md). If the repository becomes public or the plan changes, enable
protection for `master` and `dev` (no force pushes, no deletions) and update this section.

## Unit flow (high-assurance)

1. Linear issue moved to `In Progress` **before** the first commit on the unit branch.
2. Work happens on the unit branch; `bun run check` passes before every commit.
3. Unit completion = full-diff review against the mandatory review pillars, evidence
   recorded in the Linear issue and Evidence Log, then PR into `dev` (merge commit).
4. The next unit starts only after explicit owner confirmation at the unit boundary.
