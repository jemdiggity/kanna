# Task Switch Minimal Fixture Repo Design

## Goal

Replace the task-switch performance E2E substrate with a minimal committed fixture repo so the test measures task switching against a clean, deterministic repository instead of a cloned Kanna checkout.

## Problem

The current task-switch performance E2E creates tasks inside a fixture repo produced by cloning the live Kanna repository. That causes the test substrate to inherit Kanna-specific repo behavior:

- `.kanna/config.json` exists in the worktree
- PTY task startup can run repo setup commands such as `pnpm install`
- terminal output and timing are contaminated by project bootstrap work unrelated to task switching

This makes the test noisy and visually confusing. It also weakens the value of the reported switch metrics because they depend on Kanna’s own repo setup rather than on deterministic terminal switching behavior.

## Design

### Fixture Model

Each E2E fixture that needs a real repository will own its own committed seed repo content under the test tree. The seed repo is not a nested Git repository. It is just normal files checked into this repo.

For the task-switch performance test:

- add a minimal seed repo directory under `apps/desktop/tests/e2e/fixtures/repos/task-switch-minimal/`
- keep it intentionally small
- do not include `.kanna/config.json`
- do not include package-manager setup or generated build state

This keeps the fixture reviewable in the main repository and prevents accidental coupling to Kanna’s own project config.

### Runtime Repo Construction

At test runtime, the helper layer will:

1. copy the committed seed directory into a temp directory
2. initialize that copied directory as a fresh Git repo
3. create an initial commit on `main`
4. create a temp local bare repo to serve as `origin`
5. add that bare repo as the working repo’s `origin`
6. push `main` to `origin`

The E2E test then imports the working repo into Kanna and uses it as a normal repository with a real remote branch topology.

This gives the test:

- a real git repo
- a real `origin`
- disposable per-run state
- no mutation of checked-in fixture files

### Task-Switch Performance Scenario

The task-switch performance test should continue to exercise real PTY-backed task switching, but it should stop depending on repo bootstrap noise.

The revised scenario is:

1. create or spawn two PTY tasks against the minimal disposable repo
2. make each terminal emit several screens of deterministic text
3. switch between the tasks several times
4. wait for the task-switch perf recorder to capture the completed records
5. print a readable performance summary for the switching run

The terminal output should be deterministic and large enough to create meaningful scrollback. A simple shell loop that prints numbered lines is sufficient.

### Metrics Reporting

The test should report the switch metrics in a summarized human-readable form, not only by asserting the raw perf record shape.

The report should include at least:

- target task id or prompt
- whether the switch path was `warm`, `cold`, or `unknown`
- total switch duration
- mount duration
- ready duration
- first-output timing when present

If the test performs multiple switches, it should print one summary line per completed switch record or a compact grouped summary derived from all records.

## Boundaries

### What This Changes

- fixture repo creation for the task-switch performance E2E
- reusable E2E fixture helper behavior so tests can build disposable repos from committed seed content
- task-switch perf test setup and output reporting

### What This Does Not Change

- product behavior for real user repos
- repo config parsing
- PTY task creation semantics outside the test fixture boundary
- the task-switch performance recorder API

## Testing Strategy

### Unit Coverage

Add or update helper tests for the new fixture repo creation path:

- seed fixture content is copied into a temp repo
- git repo initialization succeeds
- local bare `origin` is created and connected
- cleanup removes the disposable working repo and bare remote

### E2E Coverage

Update the mocked task-switch performance E2E so it:

- uses the minimal fixture repo instead of a cloned Kanna checkout
- produces deterministic terminal output with several screens of text
- records completed task-switch perf entries
- prints summarized timing output

## Risks

### Hidden Coupling in Existing Helpers

Current fixture helpers assume cloning the live repo. Refactoring them must avoid breaking other tests that still intentionally depend on full Kanna repo behavior.

Mitigation:

- keep the existing clone-based helper available where needed
- add a new seed-fixture helper rather than silently changing all fixture semantics at once

### Cleanup Complexity

The new runtime structure includes both a working repo and a bare remote. Cleanup must remove both robustly.

Mitigation:

- store both paths in helper return values
- use retryable recursive deletion in teardown

### Metrics Still Influenced by Startup Noise

Even with a clean repo, the test can still measure task startup work instead of task switching if it switches too early.

Mitigation:

- emit deterministic terminal output first
- only begin timing-sensitive switching once both sessions are visibly active

## Recommended Implementation Shape

1. add a committed seed fixture repo for task-switch perf
2. add a new helper that materializes a disposable repo plus local bare origin from seed content
3. migrate the task-switch perf test to that helper
4. make the PTY sessions emit deterministic multi-screen output
5. report summarized switch metrics after the run
