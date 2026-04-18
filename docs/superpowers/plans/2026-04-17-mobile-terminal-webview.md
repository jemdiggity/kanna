# Mobile Terminal WebView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile task screen's text-only terminal area with a read-only `WebView` terminal surface that renders daemon snapshots more faithfully.

**Architecture:** Keep terminal state in the existing mobile store/controller, introduce a pure HTML builder for read-only terminal rendering, and embed that output in a focused `WebView` component used only by `TaskScreen`.

**Tech Stack:** React Native, Expo, `react-native-webview`, Vitest, TypeScript

---

### Task 1: Add the Read-Only Terminal HTML Builder

**Files:**
- Create: `apps/mobile/src/screens/buildTerminalDocument.ts`
- Create: `apps/mobile/src/screens/buildTerminalDocument.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests for UTF-8 metadata, HTML escaping, status fallback text, and horizontal-scroll styling.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/mobile test buildTerminalDocument -- --runInBand`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add a pure helper that returns a full HTML document from terminal output and status.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/mobile test buildTerminalDocument -- --runInBand`
Expected: PASS.

### Task 2: Embed the Terminal Surface in the Task Screen

**Files:**
- Create: `apps/mobile/src/screens/TerminalWebView.tsx`
- Modify: `apps/mobile/src/screens/TaskScreen.tsx`
- Modify: `apps/mobile/package.json`

- [ ] **Step 1: Add the package dependency**

Add `react-native-webview` to mobile dependencies.

- [ ] **Step 2: Implement the focused terminal component**

Create a read-only `TerminalWebView` component that passes generated HTML into `WebView`.

- [ ] **Step 3: Replace the transcript block in `TaskScreen`**

Swap the current `ScrollView` terminal output block for `TerminalWebView` while leaving the native composer intact.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --dir apps/mobile run typecheck`
Expected: PASS.

### Task 3: Verify the Mobile Slice

**Files:**
- Modify: `apps/mobile/src/screens/taskWorkspace.test.ts` if copy assumptions need updates

- [ ] **Step 1: Run targeted mobile tests**

Run: `pnpm --dir apps/mobile test -- --runInBand`
Expected: PASS.

- [ ] **Step 2: Sanity-check the live dev build**

Run the existing `dev.sh --mobile` flow and confirm a task shows a rendered terminal surface with preserved unicode framing.
