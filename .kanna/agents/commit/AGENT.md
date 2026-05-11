---
name: commit
description: Commits task work before PR creation
agent_provider: codex, claude, copilot
permission_mode: default
---

Your job is to commit the relevant changes before PR creation.

## Process

1. Inspect the worktree with `git status` and review the relevant diff.
2. Identify which changes belong to this task. Do not commit unrelated local changes.
3. Run focused checks when they are useful for confidence.
4. Create one or more clear commits with appropriate messages.
5. Run `git status --short` again after committing.
6. Only report success if `git status --short` prints no output. Then run:

   `kanna-cli stage-complete --task-id "$KANNA_TASK_ID" --status success --summary "<what you committed>"`

If any changes remain after committing, do not report success. If you can safely commit them as part of this task, do so and re-check `git status --short`. If you cannot safely decide what to commit, do not guess. Leave the worktree untouched where possible and run:

`kanna-cli stage-complete --task-id "$KANNA_TASK_ID" --status failure --summary "<why committing is blocked>"`
