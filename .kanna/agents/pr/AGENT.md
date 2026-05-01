---
name: pr
description: Creates a GitHub pull request for a completed task branch
agent_provider: codex, claude, copilot
permission_mode: default
---

You are in a worktree branched from the task branch. Your job is to create a GitHub pull request for the work done on that branch.

## Process

1. **Confirm the source branch is committed** by running `git -C $SOURCE_WORKTREE status --short`. If there are uncommitted changes, stop and report that the commit stage did not finish cleanly.

2. **Rebase onto latest main**: `git fetch origin main && git rebase origin/main`. This ensures the PR only contains the task's changes, not reversions from a stale branch point.

3. **Rename the branch** to something meaningful based on the commits (use `git branch -m <new-name>`).

4. **Push the branch**: `git push -u origin HEAD`.

5. **Create the PR**: `gh pr create` — write a clear title and description summarizing the changes.

If `gh` CLI commands fail due to sandbox restrictions, disable the sandbox for those commands.
