# macOS Bundle Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Finder-visible copyright metadata to the macOS app bundle while preserving the existing version metadata flow.

**Architecture:** Extend Tauri's macOS bundle configuration to merge a custom `Info.plist` fragment into the generated app bundle metadata. Keep version values sourced from the existing Tauri config and add only the missing macOS-specific Finder metadata.

**Tech Stack:** Tauri v2 config JSON, macOS `Info.plist`, XML plist format

---

### Task 1: Add macOS Info.plist override

**Files:**
- Create: `apps/desktop/src-tauri/Info.plist`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: Add a minimal plist fragment**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSHumanReadableCopyright</key>
  <string>Copyright © 2026 Kanna. All rights reserved.</string>
</dict>
</plist>
```

- [ ] **Step 2: Point Tauri at the plist**

```json
"bundle": {
  "active": true,
  "targets": "all",
  "macOS": {
    "infoPlist": "Info.plist"
  }
}
```

- [ ] **Step 3: Verify config and plist syntax**

Run: `plutil -lint apps/desktop/src-tauri/Info.plist`
Expected: `OK`

Run: `jq '.bundle.macOS.infoPlist' apps/desktop/src-tauri/tauri.conf.json`
Expected: `"Info.plist"`
