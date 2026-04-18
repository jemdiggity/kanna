# Mobile Appium Physical Device Design

## Goal

Extend the existing `apps/mobile` Appium simulator harness so local developers can run the same smoke test against one USB-attached iPhone, using the current Expo React Native development workflow and clear preflight failures.

## Scope

This design covers:

- Local developer execution only
- One attached physical iPhone at a time by default
- Optional explicit device targeting via environment override
- Real-device preflight checks
- Real-device Appium session configuration
- Reuse of the existing shared smoke test and selector layer
- Short workflow documentation for local use

This design does not cover:

- CI device farms
- Cloud device providers
- Multi-device orchestration
- Release-bundle or App Store style validation
- QR-pairing or camera automation
- Replacing Expo dev-client development with a separate production-style install path

## Current State

The branch already has a simulator-first E2E harness in `apps/mobile/e2e`:

- shared selectors and smoke spec
- Appium/XCUITest driver preflight helpers
- simulator discovery and boot helpers
- a target runner that checks desktop-server reachability before launching the smoke flow

That harness is already the correct shape for physical-device support. The new work should extend it rather than add a second unrelated test stack.

## Design Summary

The mobile E2E system should become target-aware instead of simulator-only. The smoke behavior stays shared, while the environment setup is split into simulator-specific and physical-device-specific helpers.

The design keeps the existing React Native development model:

- Expo dev client for the mobile app container
- Metro as the JavaScript bundler/dev server
- Appium + XCUITest + WebDriverAgent for automation
- the desktop-side `kanna-server` as the test backend

For physical devices, USB is used for normal developer device attachment, signing, install, and automation. The app itself continues to run in the existing dev workflow rather than introducing a second production-style bundle path just for E2E.

## Architecture

### Shared Harness

`apps/mobile/e2e` remains the single home for mobile E2E. The following pieces stay shared across simulator and physical-device targets:

- selector definitions
- smoke spec behavior
- WebdriverIO session wrapper
- Appium/XCUITest driver compatibility checks
- desktop mobile server reachability checks
- common environment parsing

The smoke spec should not care whether it is running on a simulator or on real hardware.

### Target-Specific Boundaries

Simulator-only concerns remain isolated in `helpers/simulator.ts`:

- simulator enumeration
- preferred simulator selection
- booting and boot-status checks
- simulator app-install assertions

Physical-device concerns should live in a new `helpers/device.ts`:

- connected-device discovery
- single-device selection
- optional `KANNA_IOS_DEVICE_UDID` targeting
- real-device install checks
- real-device readiness/error reporting

Appium capability generation should be split by target:

- simulator capabilities remain where they are today
- physical-device capability generation is added alongside them, not embedded ad hoc inside the runner

The top-level runner becomes target-aware and delegates setup to the correct helper path.

## Device Target Model

Physical-device v1 assumes a single attached iPhone by default.

Selection rules:

1. If `KANNA_IOS_DEVICE_UDID` is set, target that exact attached device.
2. If exactly one compatible iPhone is attached, target it automatically.
3. If no compatible device is attached, fail clearly.
4. If multiple compatible devices are attached and no override is set, fail clearly and require `KANNA_IOS_DEVICE_UDID`.

This keeps the default path simple while preserving an exact escape hatch for desks with multiple devices connected.

## Workflow

### Local Development Assumptions

This is a developer-local workflow only.

Assumptions:

- local Apple signing already works on the machine
- a physical iPhone is attached over USB
- the developer can build/install the app locally
- the phone can reach the laptop’s normal React Native development services in the current environment

The design does not attempt to invent a USB-only JavaScript bundle delivery path. That would add complexity without improving the actual confidence we want from v1.

### Development Model

The physical-device flow should continue to use:

- Expo dev client for the native app shell
- Metro for JavaScript development bundle delivery

This is intentionally aligned with the current mobile development model. Physical-device E2E is meant to validate real hardware execution and automation, not introduce a second build/runtime stack that developers do not otherwise use.

### Command Shape

The script surface should gain explicit physical-device commands under `apps/mobile/package.json`, parallel to the simulator flow:

- `test:e2e:device:preflight`
- `test:e2e:device:smoke`

These commands should reuse the shared E2E runner and shared smoke spec, while selecting the physical-device path internally.

## Preflight Behavior

Physical-device preflight should verify the following before smoke execution:

- Appium XCUITest driver is installed and compatible with the local Appium version
- one target physical device has been selected
- the desktop mobile server is reachable
- the app bundle id is resolved
- the app is installed on the target device, or the failure explains exactly what install/build step is missing
- the device is usable for Appium/XCUITest automation

Preflight should fail before session creation when any of these prerequisites are missing.

## Smoke Behavior

The physical-device smoke run should reuse the same shared smoke flow as the simulator run:

1. launch the app session on the target device
2. wait for the app shell
3. normalize back to the task list if the app resumes on task detail
4. open the first available task
5. wait for the detail screen/back affordance
6. navigate back to the task list

The important architectural constraint is that this remains one smoke spec, not duplicated simulator/device logic.

## Failure Boundaries

Physical-device support must fail clearly. These failure cases should be first-class:

### No Device Attached

Fail with a direct message that no attached iPhone was found.

### Multiple Devices Without Override

Fail with a message that lists the discovered devices and instructs the developer to set `KANNA_IOS_DEVICE_UDID`.

### Missing or Incompatible Appium Driver

Fail with the exact install or repair command needed to restore the XCUITest driver.

### Desktop Mobile Server Unreachable

Fail before session creation and include the exact unreachable URL.

### App Missing on Device

Fail with a direct instruction that the app is not installed or not launchable on the selected device. Do not collapse this into a generic Appium startup failure.

### Signing, WDA, or Device Automation Failure

Bubble up the relevant Appium/Xcode/WebDriverAgent error with enough fidelity that the developer can tell whether the failure is:

- signing-related
- WDA-related
- device-trust-related
- launch/install-related

The runner should not replace those errors with vague “smoke failed” messaging.

## Testing Strategy

### Unit-Level Verification

Fast tests should cover:

- physical-device environment parsing
- device selection rules
- physical-device capability generation
- preflight decision logic and failure messaging

### End-to-End Verification

The primary proof remains the real hardware smoke run on an attached iPhone.

Success means a developer can:

1. install/run the app in the current Expo dev workflow
2. run device preflight successfully
3. run device smoke successfully against one attached iPhone

## Documentation

Add a short physical-device section to the mobile E2E workflow docs. It should state clearly that the path is:

- local-only
- developer-signed
- one attached device by default
- optionally targetable by `KANNA_IOS_DEVICE_UDID`

The docs should include the minimum command sequence to:

- ensure the app is installed on the device
- run device preflight
- run device smoke

## Success Criteria

This slice is complete when:

- the shared harness supports both simulator and physical-device targets
- physical-device preflight exists and fails clearly
- physical-device smoke reuses the shared smoke spec
- one attached iPhone can run the smoke path locally with the normal RN dev workflow
- the local workflow is documented well enough that another developer can repeat it without reading the harness internals
