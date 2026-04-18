# Repo-Wide E2E Coverage Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-wide testing guideline requiring E2E coverage for cross-boundary behavior changes, with explicit exceptions when coverage is not yet practical.

**Architecture:** Implement the policy as a repo-wide engineering rule in `AGENTS.md` so it affects future implementation and review behavior. Keep the change forward-looking, aligned with the approved spec, and limited to guidance text rather than code or tooling changes.

**Tech Stack:** Markdown documentation in `AGENTS.md`, spec/plan docs under `docs/superpowers/`

---

### Task 1: Add The Repo-Wide E2E Policy To `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`
- Reference: `docs/superpowers/specs/2026-04-18-repo-wide-e2e-coverage-policy-design.md`

- [ ] **Step 1: Review the approved spec and the current Testing section**

Read:

```text
docs/superpowers/specs/2026-04-18-repo-wide-e2e-coverage-policy-design.md
AGENTS.md
```

Expected: the spec defines a forward-looking repo-wide rule that requires E2E coverage for cross-boundary behavior changes, while allowing explicit exceptions.

- [ ] **Step 2: Add the policy text to the `## Testing` section in `AGENTS.md`**

Insert guidance equivalent to:

```md
### E2E coverage expectation

Any behavior that crosses component or system boundaries should add or update at least one E2E test.

Typical triggers include:

- UI flows, navigation, and interactive user journeys
- frontend/mobile to backend or server interactions
- daemon, PTY, process, filesystem, git, or network behavior
- persistence, reload, reconnect, or recovery behavior
- asynchronous coordination where isolated tests do not prove the real wiring

Unit and integration tests remain important, but they are not a substitute when the risk is in the wiring between systems.

If a behavior should have E2E coverage but cannot reasonably get it yet, the change must explicitly document:

- why it is not yet testable end to end
- what would be needed to make it testable
- what narrower tests were added in the meantime
```

Expected: the new section reads as a repo-wide default expectation rather than a retroactive mandate.

- [ ] **Step 3: Verify the edit matches the approved scope**

Check manually that the final text:

- is repo-wide
- is forward-looking
- focuses on cross-boundary behavior
- keeps explicit exceptions
- does not require retroactive full-repo E2E coverage

Expected: no contradictions with the approved spec.

- [ ] **Step 4: Run a minimal verification pass**

Run:

```bash
git diff -- AGENTS.md
```

Expected: only the intended policy guidance appears in the diff.

- [ ] **Step 5: Commit**

Run:

```bash
git add AGENTS.md docs/superpowers/plans/2026-04-18-repo-wide-e2e-coverage-policy.md
git commit -m "Add repo-wide E2E coverage guidance"
```

Expected: a single commit containing the policy change and its implementation plan.
