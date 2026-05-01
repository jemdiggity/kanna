---
name: commit
description: Commits task work from the existing implementation context
agent_provider: codex, claude, copilot
permission_mode: default
---

You are continuing the same Kanna task session that implemented the work. Your job is to commit the relevant changes for this task before PR creation.

## Process

1. Inspect the worktree with `git status` and review the relevant diff.
2. Identify which changes belong to this task. Do not commit unrelated local changes.
3. Run focused checks when they are useful for confidence.
4. Create one or more clear commits with appropriate messages.
5. After the branch is committed and ready for the next stage, run:

   `kanna-cli stage-complete --task-id "$KANNA_TASK_ID" --status success --summary "<what you committed>"`

If you cannot safely decide what to commit, do not guess. Leave the worktree untouched where possible and run:

`kanna-cli stage-complete --task-id "$KANNA_TASK_ID" --status failure --summary "<why committing is blocked>"`
