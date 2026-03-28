# Agent CLI Setup Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first launch (no repos), show which agent CLIs are installed and guide users to install missing ones.

**Architecture:** Frontend-driven detection using existing `which_binary` and `run_script` Tauri commands. The empty state in `MainPanel.vue` gains CLI status cards. The `⇧⌘J` shortcut is extended to open a shell at `$HOME` when no repo is selected, and closing that shell triggers a re-check.

**Tech Stack:** Vue 3, Tauri IPC (`invoke`), existing `which_binary` / `run_script` commands, `navigator.clipboard`

**User Verification:** NO

---

## File Structure

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/components/MainPanel.vue` | CLI detection logic, agent status cards UI, re-check on shell close |
| `apps/desktop/src/App.vue` | Remove repo guard from `openShellRepoRoot`, compute `$HOME` fallback, emit shell-close event to MainPanel |
| `apps/desktop/src/i18n/locales/en.json` | English strings for agent setup cards |
| `apps/desktop/src/i18n/locales/ja.json` | Japanese strings |
| `apps/desktop/src/i18n/locales/ko.json` | Korean strings |

No new files created. All changes are modifications to existing files.

---

### Task 1: Add i18n strings for agent setup cards

**Goal:** Add all i18n keys needed by the agent setup UI to all three locale files.

**Files:**
- Modify: `apps/desktop/src/i18n/locales/en.json:213-222` (mainPanel section)
- Modify: `apps/desktop/src/i18n/locales/ja.json` (mainPanel section)
- Modify: `apps/desktop/src/i18n/locales/ko.json` (mainPanel section)

**Acceptance Criteria:**
- [ ] English strings added under `mainPanel` key
- [ ] Japanese strings added under `mainPanel` key
- [ ] Korean strings added under `mainPanel` key
- [ ] `bun tsc --noEmit` passes (i18n keys are untyped, but no regressions)

**Verify:** `cd apps/desktop && bun tsc --noEmit` → exits 0

**Steps:**

- [ ] **Step 1: Add English strings**

In `apps/desktop/src/i18n/locales/en.json`, add these keys inside the `"mainPanel"` object after the existing `"noReposHint"` key:

```json
"agentSetupTitle": "Agent Setup",
"agentInstalled": "Installed",
"agentNotInstalled": "Not installed",
"agentInstallHint": "Press {shellShortcut} to open a shell, and again to close it.",
"agentVersion": "v{version}",
"agentClaudeName": "Claude Code",
"agentCopilotName": "GitHub Copilot",
"agentCopied": "Copied!"
```

- [ ] **Step 2: Add Japanese strings**

In `apps/desktop/src/i18n/locales/ja.json`, add matching keys inside `"mainPanel"`:

```json
"agentSetupTitle": "エージェントセットアップ",
"agentInstalled": "インストール済み",
"agentNotInstalled": "未インストール",
"agentInstallHint": "{shellShortcut} でシェルを開き、もう一度押すと閉じます。",
"agentVersion": "v{version}",
"agentClaudeName": "Claude Code",
"agentCopilotName": "GitHub Copilot",
"agentCopied": "コピーしました！"
```

- [ ] **Step 3: Add Korean strings**

In `apps/desktop/src/i18n/locales/ko.json`, add matching keys inside `"mainPanel"`:

```json
"agentSetupTitle": "에이전트 설정",
"agentInstalled": "설치됨",
"agentNotInstalled": "미설치",
"agentInstallHint": "{shellShortcut}을 눌러 셸을 열고, 다시 누르면 닫힙니다.",
"agentVersion": "v{version}",
"agentClaudeName": "Claude Code",
"agentCopilotName": "GitHub Copilot",
"agentCopied": "복사되었습니다!"
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/desktop && bun tsc --noEmit`
Expected: exits 0

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json apps/desktop/src/i18n/locales/ko.json
git commit -m "feat: add i18n strings for agent CLI setup cards"
```

---

### Task 2: Add agent CLI detection and setup cards to MainPanel empty state

**Goal:** When no repos exist, the empty state shows two agent cards — each displaying install instructions (with copy button) or installed status with version.

**Files:**
- Modify: `apps/desktop/src/components/MainPanel.vue:1-184`

**Acceptance Criteria:**
- [ ] `which_binary("claude")` and `which_binary("copilot")` called on mount when `!hasRepos`
- [ ] For installed CLIs, `run_script("<binary> --version", ...)` extracts semver via `/(\d+\.\d+\.\d+)/`
- [ ] Not-installed card shows agent name, install command, copy button, shell hint
- [ ] Installed card shows agent name, green checkmark, version
- [ ] Copy button copies the install command and shows brief "Copied!" feedback
- [ ] "Import a repo" hint (`⌘I`) still appears below the agent cards
- [ ] `bun tsc --noEmit` passes

**Verify:** `cd apps/desktop && bun tsc --noEmit` → exits 0

**Steps:**

- [ ] **Step 1: Add reactive state and detection logic to `<script setup>`**

Replace the existing `<script setup>` block in `MainPanel.vue` with:

```typescript
<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import type { PipelineItem } from "@kanna/db";
import { invoke } from "../invoke";
import TaskHeader from "./TaskHeader.vue";
import TerminalTabs from "./TerminalTabs.vue";

const { t } = useI18n();

const props = defineProps<{
  item: PipelineItem | null;
  repoPath?: string;
  spawnPtySession?: (sessionId: string, cwd: string, prompt: string, cols: number, rows: number) => Promise<void>;
  maximized?: boolean;
  blockers?: PipelineItem[];
  hasRepos?: boolean;
}>();

const emit = defineEmits<{
  (e: "agent-completed"): void;
}>();

const isBlocked = computed(() => {
  if (!props.blockers || props.blockers.length === 0) return false;
  return props.blockers.some(b => !b.closed_at);
});

// --- Agent CLI detection ---

interface AgentCliStatus {
  installed: boolean;
  version?: string;
}

const claude = ref<AgentCliStatus>({ installed: false });
const copilot = ref<AgentCliStatus>({ installed: false });
const copiedAgent = ref<string | null>(null);

const INSTALL_COMMANDS: Record<string, string> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  copilot: "curl -fsSL https://gh.io/copilot-install | bash",
};

function parseSemver(output: string): string | undefined {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match?.[1];
}

async function checkCli(name: string): Promise<AgentCliStatus> {
  try {
    await invoke("which_binary", { name });
  } catch {
    return { installed: false };
  }
  try {
    const output = await invoke("run_script", {
      script: `${name} --version`,
      cwd: "/",
      env: {},
    }) as string;
    return { installed: true, version: parseSemver(output) };
  } catch {
    // Binary found but version check failed — still installed
    return { installed: true };
  }
}

async function checkAllClis() {
  const [c, p] = await Promise.all([checkCli("claude"), checkCli("copilot")]);
  claude.value = c;
  copilot.value = p;
}

// Run detection when the no-repos empty state is visible
watch(() => props.hasRepos, (has) => {
  if (!has) checkAllClis();
}, { immediate: true });

// Expose re-check so App.vue can trigger it on shell close
defineExpose({ recheckClis: checkAllClis });

async function copyCommand(agent: string) {
  const cmd = INSTALL_COMMANDS[agent];
  if (!cmd) return;
  await navigator.clipboard.writeText(cmd);
  copiedAgent.value = agent;
  setTimeout(() => { copiedAgent.value = null; }, 1500);
}
</script>
```

- [ ] **Step 2: Replace the no-repos template block**

Replace the `<template v-if="!hasRepos">` block (lines 60-62) with:

```html
<template v-if="!hasRepos">
  <div class="agent-setup">
    <p class="setup-title">{{ $t('mainPanel.agentSetupTitle') }}</p>
    <div class="agent-cards">
      <div v-for="agent in [
        { key: 'claude', nameKey: 'mainPanel.agentClaudeName', status: claude },
        { key: 'copilot', nameKey: 'mainPanel.agentCopilotName', status: copilot },
      ]" :key="agent.key" class="agent-card">
        <div class="agent-header">
          <span class="agent-name">{{ $t(agent.nameKey) }}</span>
          <span v-if="agent.status.installed" class="agent-badge installed">
            <span class="checkmark">✓</span>
            {{ $t('mainPanel.agentVersion', { version: agent.status.version || '?' }) }}
          </span>
          <span v-else class="agent-badge not-installed">
            {{ $t('mainPanel.agentNotInstalled') }}
          </span>
        </div>
        <div v-if="!agent.status.installed" class="install-block">
          <code class="install-cmd">{{ INSTALL_COMMANDS[agent.key] }}</code>
          <button
            class="copy-btn"
            :title="copiedAgent === agent.key ? $t('mainPanel.agentCopied') : 'Copy'"
            @click="copyCommand(agent.key)"
          >
            {{ copiedAgent === agent.key ? '✓' : '⧉' }}
          </button>
        </div>
      </div>
    </div>
    <p class="setup-hint">
      {{ $t('mainPanel.agentInstallHint', { shellShortcut: '⇧⌘J' }) }}
    </p>
    <p class="empty-hint">{{ $t('mainPanel.noReposHint', { shortcut: '⌘I' }) }}</p>
  </div>
</template>
```

- [ ] **Step 3: Add styles for agent setup cards**

Append these styles inside `<style scoped>`:

```css
.agent-setup {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  max-width: 480px;
  margin: 0 auto;
  padding: 32px;
}

.setup-title {
  font-size: 15px;
  font-weight: 500;
  color: #888;
  margin-bottom: 4px;
}

.agent-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.agent-card {
  background: #222;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 14px 16px;
}

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agent-name {
  font-size: 13px;
  font-weight: 600;
  color: #ccc;
}

.agent-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
}

.agent-badge.installed {
  color: #4ade80;
  background: rgba(74, 222, 128, 0.1);
}

.agent-badge.not-installed {
  color: #888;
  background: #2a2a2a;
}

.checkmark {
  margin-right: 4px;
}

.install-block {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.install-cmd {
  flex: 1;
  font-size: 11px;
  font-family: monospace;
  color: #aaa;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 6px 10px;
  overflow-x: auto;
  white-space: nowrap;
}

.copy-btn {
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #aaa;
  font-size: 13px;
  padding: 4px 8px;
  cursor: pointer;
  flex-shrink: 0;
}

.copy-btn:hover {
  background: #333;
  color: #ccc;
}

.setup-hint {
  font-size: 12px;
  color: #555;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/desktop && bun tsc --noEmit`
Expected: exits 0

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/MainPanel.vue
git commit -m "feat: add agent CLI detection and setup cards to empty state"
```

---

### Task 3: Enable shell at `$HOME` and re-check on shell close

**Goal:** `⇧⌘J` opens ShellModal to `$HOME` when no repo is selected. Closing ShellModal triggers CLI re-check in the empty state.

**Files:**
- Modify: `apps/desktop/src/App.vue:483-496` (openShellRepoRoot handler)
- Modify: `apps/desktop/src/App.vue:842-851` (ShellModal template)

**Acceptance Criteria:**
- [ ] `⇧⌘J` works with no repo selected — shell opens at `$HOME`
- [ ] ShellModal `v-if` no longer requires `store.selectedRepo` when `shellRepoRoot` is true
- [ ] Closing ShellModal calls `recheckClis()` on MainPanel ref (when no repos)
- [ ] `bun tsc --noEmit` passes

**Verify:** `cd apps/desktop && bun tsc --noEmit` → exits 0

**Steps:**

- [ ] **Step 1: Cache `$HOME` on app mount**

In `App.vue`, near the existing refs (around line 73), add:

```typescript
const homePath = ref("");
```

In the existing `onMounted` (or create one if needed), add:

```typescript
invoke("read_env_var", { name: "HOME" }).then((val) => {
  homePath.value = val as string;
}).catch(() => {
  homePath.value = "/Users";
});
```

- [ ] **Step 2: Add MainPanel ref**

Near the other component refs (line 93-100), add:

```typescript
const mainPanelRef = ref<InstanceType<typeof MainPanel> | null>(null);
```

And add `ref="mainPanelRef"` to the `<MainPanel>` component in the template.

- [ ] **Step 3: Modify `openShellRepoRoot` handler**

Replace the `openShellRepoRoot` handler (lines 483-496) with:

```typescript
openShellRepoRoot: () => {
  if (showShellModal.value && shellRepoRoot.value) {
    const z = shellModalRef.value?.zIndex ?? 0;
    if (isTopModal(z)) {
      showShellModal.value = false;
      maximizedModal.value = null;
    } else {
      shellModalRef.value?.bringToFront();
    }
  } else {
    shellRepoRoot.value = true;
    showShellModal.value = true;
  }
},
```

This removes the `if (!store.selectedRepo) return` guard.

- [ ] **Step 4: Update ShellModal template for no-repo case**

Replace the ShellModal block (lines 842-851) with:

```html
<KeepAlive :max="10">
  <ShellModal
    ref="shellModalRef"
    v-if="showShellModal && (store.selectedRepo ? (shellRepoRoot || store.currentItem) : shellRepoRoot)"
    :key="`shell-${shellRepoRoot && !store.selectedRepo ? 'home' : shellRepoRoot ? `repo-${store.selectedRepo!.id}` : `wt-${store.currentItem?.id}`}`"
    :session-id="`shell-${shellRepoRoot && !store.selectedRepo ? 'home' : shellRepoRoot ? `repo-${store.selectedRepo!.id}` : `wt-${store.currentItem?.id}`}`"
    :cwd="shellRepoRoot && !store.selectedRepo ? homePath : shellRepoRoot ? store.selectedRepo!.path : (store.currentItem?.branch ? `${store.selectedRepo!.path}/.kanna-worktrees/${store.currentItem.branch}` : store.selectedRepo!.path)"
    :port-env="shellRepoRoot ? undefined : store.currentItem?.port_env"
    :maximized="maximizedModal === 'shell'"
    @close="onShellClose"
  />
</KeepAlive>
```

- [ ] **Step 5: Add `onShellClose` handler**

Near the shortcut handlers, add:

```typescript
function onShellClose() {
  showShellModal.value = false;
  maximizedModal.value = null;
  if (!store.repos.length) {
    mainPanelRef.value?.recheckClis?.();
  }
}
```

Then update the other shell close locations (`openShell` and `openShellRepoRoot` toggle-off paths) to also call `onShellClose()` instead of directly setting `showShellModal.value = false; maximizedModal.value = null;`.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd apps/desktop && bun tsc --noEmit`
Expected: exits 0

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/App.vue
git commit -m "feat: enable shell at \$HOME with no repo, re-check CLIs on close"
```
