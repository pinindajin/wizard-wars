---
name: wz--pr-main-to-prod
description: >-
  Open a GitHub pull request to merge main into prod with patch notes in the
  body summarizing commits and changes on main that are not yet on prod, for
  the Wizard Wars repo. Use when the user asks for a prod release PR, merge
  main to prod, promote main to production, or ship main to the prod branch.
---

# PR: merge `main` into `prod` (Wizard Wars)

Use this workflow when promoting **`main`** to **`prod`** via GitHub. The PR **base** is `prod` (receives the merge); the **head** is `main` (incoming work).

Do **not** use a one-line `gh pr create` with an empty body. The description must include **patch notes**: a readable summary of what lands on `prod` that is not already there.

## Prerequisites

- **`gh`** authenticated for this repo (`gh auth status`), or use GitHub MCP `create_pull_request` with the same title and body.
- Remote **`origin`** has both **`main`** and **`prod`**. If your integration branch is not named `main`, substitute it consistently in commands below.

## Step 1: Sync and verify branches

1. `git fetch origin main prod` (or `git fetch origin`).
2. Confirm both tips exist, e.g. `git rev-parse origin/main origin/prod`.
3. **Commits to ship:** `git log origin/prod..origin/main --oneline`  
   - If this prints **nothing**: there is nothing to promote—tell the user and **do not** open a PR.
4. **Divergence check:** `git log origin/main..origin/prod --oneline`  
   - If non-empty, `prod` has commits not on `main`. Note this in the PR under **Risks** (true merge vs reset strategy is a team decision).

## Step 2: Check for an existing PR

- `gh pr list --base prod --head main --state open`  
  - If one exists, return its URL and offer to update the description instead of creating a duplicate.

## Step 3: Gather material for patch notes

Run (read output; use it to write the summary—not as the only body content):

| Purpose | Command |
|--------|---------|
| Full commit list (titles) | `git log origin/prod..origin/main --format="%h %s"` |
| Merge commits / structure | `git log origin/prod..origin/main --merges --oneline` |
| Files touched (high level) | `git diff --stat origin/prod...origin/main` |
| Compare URL (fill owner/repo) | `https://github.com/<owner>/<repo>/compare/prod...main` |

Optional: resolve compare URL with `gh repo view --json url -q .url` and append `/compare/prod...main`.

## Step 4: Write patch notes (human summary)

Turn the git output into **patch notes**, not a raw unedited dump:

- **Group** related commits (features, fixes, chores, deps, docs).
- **Collapse** noisy “fix typo” / “address review” chains into one bullet when they belong to the same change.
- Call out **user-visible** or **deploy-sensitive** items: Prisma migrations, env vars / secrets, breaking API, **Colyseus** room or protocol changes, Next.js / Bun runtime or build changes.
- Keep **technical accuracy**: do not invent work that is not in `origin/prod..origin/main`.

Include a **Commit range** line, e.g. `origin/prod` @ `<short-sha>` → `origin/main` @ `<short-sha>`, and the **commit count** (`git rev-list --count origin/prod..origin/main`).

## Step 5: Title and body template

**Title** (pick one style; include date if releases are dated):

- `chore(release): merge main into prod`  
- or `release: promote main to prod (YYYY-MM-DD)`

**Body** — copy the template; replace placeholders. Use `N/A` where a section does not apply (do not delete sections).

```markdown
## Summary

Merge latest `main` into `prod` for production deployment.

## Patch notes

<!-- 5–15 bullets: grouped, accurate summary of origin/prod..origin/main -->

- …

## Scope

- **Commits**: <count> (`origin/prod` @ `<sha>` → `origin/main` @ `<sha>`)
- **Compare**: <https://github.com/owner/repo/compare/prod...main>

## Full commit list

<details>
<summary>Click to expand</summary>

```
<paste output of: git log origin/prod..origin/main --format="%h %s">
```

</details>

## Verification

- [ ] `origin/prod..origin/main` non-empty and reviewed
- [ ] CI / release checklist per team process (or **N/A**)
- [ ] E2E: Playwright E2E runs on PRs **to `prod`** (and pushes to `prod`), not on PRs to `main`—expect E2E on this PR; see `tests/e2e/README.md`

## Risks & notes

- **prod-only commits**: <yes/no; if yes, summarize `git log origin/main..origin/prod`>
- <deploy, DB, env, Colyseus, or rollback notes, or **N/A**>
```

## Step 6: Create the PR

Write the body to a temp file, then:

```bash
gh pr create --base prod --head main --title "<title>" --body-file /path/to/body.md
```

Return the **PR URL** to the user.

If `gh` is unavailable, open the PR in the GitHub UI with the same title and body, or use GitHub MCP with `base: prod`, `head: main`, matching title and body.

## Notes

- This skill is **only** for **`main` → `prod`**. Feature work still merges into `main` through your normal PR process; use this skill when promoting that line into production.
- Patch notes must reflect **actual** `git log origin/prod..origin/main` output; when in doubt, prefer more detail in the collapsed commit list and stay conservative in the top-level bullets.
