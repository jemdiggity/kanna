# Mobile Appium Simulator E2E Design

Date: 2026-04-18
Status: Proposed
Scope: Local-only iOS simulator E2E automation for the React Native mobile app, with a migration path to physical-device testing

## Summary

Kanna should add a local-only mobile E2E harness based on Appium 2, the XCUITest driver, and WebDriverAgent.
The first slice should target a single iOS simulator profile and cover a small smoke suite against the existing React Native client and desktop-backed mobile API.

The setup should be intentionally simulator-first, but it must not paint the project into a simulator-only corner.
The same test runner, capabilities builder, and selector strategy should later support physical-device execution with minimal structural change.

## Goals

- Add a reproducible local iOS simulator E2E path for `apps/mobile`
- Use Appium/XCUITest/WDA now so the same automation stack can later drive real devices
- Fit Appium port allocation into Kanna's existing worktree-aware port model
- Keep the first slice small enough to become reliable before expanding coverage
- Exercise the app against the real desktop-side mobile API boundary rather than inventing a parallel automation-only backend

## Non-Goals

- CI integration in the first slice
- Android automation
- Full physical-device setup in the first slice
- Broad end-to-end coverage of every mobile workflow
- Replacing existing desktop E2E infrastructure

## Why Appium

Appium is the correct first choice because it matches the long-term test topology.
The project already knows that physical-device coverage will matter, and Appium plus XCUITest plus WDA is the path that naturally extends from simulator to USB device.

Detox would likely be pleasant for early simulator-only React Native tests, but it would split the automation story and create migration work once real-device coverage becomes a requirement.
Native XCTest-only UI automation would also work, but it would fit less cleanly with repo-driven scripting and future external automation.

## Architecture Overview

The first slice should treat the mobile E2E harness as a sibling of the app, not as an extension of the desktop Tauri E2E runner.

The test topology should be:

`Appium test runner -> Appium server -> XCUITest driver/WDA -> iOS simulator -> React Native app -> desktop-side kanna-server`

Supporting processes:

- Metro dev server for React Native debug bundles
- Desktop-side mobile API, started via the existing dev workflow

The mobile app should continue to fetch data from the desktop-side server exactly as it does during normal development.
The automation layer should never bypass the public mobile API to reach into desktop stores or Tauri internals.

## Port Model

The project should add one new repo-configured port:

- `KANNA_APPIUM_PORT`

This port belongs in `.kanna/config.json` under `ports` so it participates in the same worktree-aware offset allocation as:

- `KANNA_DEV_PORT`
- `KANNA_MOBILE_PORT`
- `KANNA_RELAY_PORT`

This ensures multiple worktrees can run their own Appium instances without manual coordination.

### Derived Ports

The first slice should not add a second explicit repo-configured port for WebDriverAgent.

Instead:

- Appium listens on `KANNA_APPIUM_PORT`
- WDA port is derived inside the mobile E2E harness, initially as `KANNA_APPIUM_PORT + 1`

This keeps the configuration surface small while leaving open the option to promote WDA to an explicit configured port later if collisions or operational needs justify it.

## Process Model

The local test workflow should assume the operator starts Kanna in the supported mobile-aware dev mode:

- `./scripts/dev.sh --mobile`
- or `./scripts/mobile-dev.sh`

This matters because the mobile app alone is not enough.
The React Native app still depends on the desktop-side `kanna-server` process being alive and reachable.

The E2E harness should then be responsible for:

- verifying simulator availability
- starting or reusing Appium on `KANNA_APPIUM_PORT`
- selecting the iOS simulator target
- launching the already-built or buildable app
- executing smoke specs

The harness should not be responsible for inventing a separate server bootstrap path if the normal Kanna mobile dev flow already provides one.

## First Simulator Target

The first slice should standardize on one default simulator profile so the environment is deterministic.

Recommended default:

- `iPhone 15`

The runtime should be whichever installed iOS simulator runtime Xcode provides locally.
The test harness should allow an override later, but it should default to one concrete profile rather than forcing every invocation to specify a device name.

## File Layout

The mobile E2E system should live under `apps/mobile` and remain separate from the desktop E2E runner.

Recommended structure:

- `apps/mobile/e2e/appium.config.ts`
  Central capability builder and local Appium configuration
- `apps/mobile/e2e/helpers/`
  Small helpers for simulator boot, process waiting, selector utilities, and app launch coordination
- `apps/mobile/e2e/specs/smoke/`
  Narrow smoke suite only
- `apps/mobile/scripts/`
  Local orchestration scripts for Appium server startup and test execution

The mobile harness should not be folded into `apps/desktop/tests/e2e/`.
The runtime, transport, and dependency stack are different enough that sharing one test runner would create unnecessary coupling.

## Test Runner Shape

The first slice should support a single local command family from `apps/mobile/package.json`, for example:

- `test:e2e`
- `test:e2e:smoke`
- `test:e2e:appium:start`

The exact command names can be finalized during implementation, but the responsibilities should stay split:

- one script to start Appium locally
- one script to execute the test suite
- one smoke entrypoint that uses the default local simulator profile

## Capability Model

The capability builder should encode the difference between simulator and physical-device execution behind one typed interface.

The first implementation should only instantiate simulator capabilities, but it should be structured to grow into:

- simulator capability set
- physical-device capability set

Fields that should be centralized:

- platform name
- automation name
- device name
- platform version override when provided
- app bundle identifier or app path
- derived WDA local port
- no-reset/full-reset behavior

The future physical-device path should require only a change to the selected capability profile, not a rewrite of the tests themselves.

## App Launch Strategy

For the first slice, the app should run as a debug/development build backed by Metro.

That means the E2E harness depends on:

- Metro being reachable
- the generated iOS project being present or reproducible
- the simulator being able to launch the debug app through XCUITest/Appium

The harness should not try to introduce a release-bundle-based flow in the first slice.
That would create a second launch topology and distract from validating the smoke test infrastructure.

## Selector Strategy

Reliable Appium tests require stable `testID` coverage in the React Native UI.
The first slice should add explicit `testID`s anywhere selectors are currently visual-only or text-fragile.

Required first-wave selectors:

- app shell root
- tasks screen root
- recent screen root if used in smoke coverage
- task list row
- task detail root
- task detail back button
- more or plus button used to open the command surface
- create-task composer input if that flow enters the first suite
- send button
- terminal disabled/error overlay

Selectors should prefer stable IDs over label matching.
The tests should not key off decorative copy when a structural identifier can be added.

## First Smoke Suite

The initial smoke suite should remain intentionally small:

1. App launches and reaches the connected shell without an immediate connection error
2. Task list renders at least one task from the desktop-backed API
3. Tapping a task opens the task detail screen
4. Back navigation returns to the list

The next wave can expand to:

- opening the command surface
- create-task flow
- terminal overlay assertions
- more detailed terminal availability checks

The first suite should prove the stack, not attempt to certify every workflow.

## Failure Model

The harness should fail fast with explicit messages for common local setup problems:

- Appium is missing
- XCUITest driver is not installed
- simulator runtime is unavailable
- Metro is down
- desktop-side mobile API is unreachable
- target app cannot be launched

These failures should be surfaced before test execution begins whenever possible.
The goal is to make local setup problems diagnosable without digging through raw WDA logs first.

## Local-Only Scope

The first slice should be designed for local execution only.

That means:

- no CI-specific abstractions
- no macOS runner assumptions
- no cloud device-farm work
- no attempt to stabilize parallel simulator workers yet

This keeps the implementation focused on one reliable operator workflow.

## Path To Physical Devices

The design should preserve a straightforward later expansion to USB-attached iPhones.

What stays the same:

- Appium server
- XCUITest driver
- WDA
- test runner entrypoints
- test specs
- selector strategy

What changes later:

- capability profile switches from simulator to device
- signing and WDA device setup becomes part of the local prerequisites
- the harness may need explicit bundle installation and device-target selection options

Because the automation stack is shared, the simulator work is not throwaway.

## Risks

### Metro and Desktop API Coordination

The mobile app depends on both Metro and the desktop-side mobile API.
If either side is missing, tests will fail in ways that can look like app regressions.

The harness therefore needs explicit preflight checks rather than assuming the environment is ready.

### Weak Selectors

If the RN UI lacks `testID`s in key areas, the first Appium suite will become fragile immediately.
Selector work is a core part of the first implementation, not optional cleanup.

### Generated iOS Project Drift

The iOS project is currently generated through Expo prebuild.
The E2E harness should assume that project exists or can be regenerated consistently, but it should avoid depending on manual one-off Xcode state.

## Acceptance Criteria

The first implementation is successful when:

- `KANNA_APPIUM_PORT` is sourced through `.kanna/config.json` port handling
- a local command can start Appium and run the mobile smoke suite against an iOS simulator
- the smoke suite can launch the app and verify the list -> detail -> back flow
- required `testID`s are present for the smoke suite
- the harness structure can later add a physical-device capability profile without replacing the test stack
