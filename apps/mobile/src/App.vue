<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { MobileRepo, MobileTab, MobileTask } from "./lib/mobile-types";
import { loadMobileRepos, loadMobileTasks } from "./lib/mobile-data";
import { buildRecentTasks, groupTasksByRepo } from "./lib/task-list";
import CommandPaletteSheet from "./components/CommandPaletteSheet.vue";
import MobileHeader from "./components/MobileHeader.vue";
import FloatingToolbar from "./components/FloatingToolbar.vue";
import RecentScreen from "./components/RecentScreen.vue";
import TaskScreen from "./components/TaskScreen.vue";
import TaskSearchSheet from "./components/TaskSearchSheet.vue";
import TasksScreen from "./components/TasksScreen.vue";

const currentTab = ref<MobileTab>("tasks");
const repos = ref<MobileRepo[]>([]);
const tasks = ref<MobileTask[]>([]);
const selectedTask = ref<MobileTask | null>(null);
const error = ref<string | null>(null);
const showCommandSheet = ref(false);
const showSearchSheet = ref(false);

const taskGroups = computed(() => groupTasksByRepo(tasks.value));
const recentTasks = computed(() => buildRecentTasks(tasks.value));
const headerTitle = computed(() => (currentTab.value === "recent" ? "Recent" : "Tasks"));
const headerSubtitle = computed(() => (currentTab.value === "recent" ? "Pan-repo task updates" : "Grouped by repository"));
const commandSheetTitle = computed(() => (selectedTask.value ? "Task Actions" : "More"));
const currentCommands = computed(() =>
  selectedTask.value
    ? [
        {
          id: "promote-stage",
          label: "Promote Stage",
          description: "Requires the next mobile/server command slice.",
          disabled: true,
        },
        {
          id: "run-merge-agent",
          label: "Run Merge Agent",
          description: "Requires the next mobile/server command slice.",
          disabled: true,
        },
        {
          id: "close-task",
          label: "Close Task",
          description: "Requires the next mobile/server command slice.",
          disabled: true,
        },
      ]
    : [
        { id: "new-task", label: "New Task", description: "New task creation UI is next.", disabled: true },
        { id: "search", label: "Search", description: "Global task jump/search UI is next.", disabled: true },
        { id: "preferences", label: "Preferences", description: "Mobile preferences are not wired yet.", disabled: true },
      ],
);

async function loadData() {
  try {
    repos.value = await loadMobileRepos();
    tasks.value = (
      await Promise.all(repos.value.map((repo) => loadMobileTasks(repo.id, repo.name)))
    ).flat();
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function selectTask(task: MobileTask) {
  selectedTask.value = task;
  showSearchSheet.value = false;
}

function goBack() {
  selectedTask.value = null;
}

function handleToolbarSelect(tab: MobileTab) {
  if (tab === "more") {
    showCommandSheet.value = true;
    return;
  }
  currentTab.value = tab;
}

function openSearch() {
  showSearchSheet.value = true;
}

function openNewTask() {
  showCommandSheet.value = true;
}

function handleCommandExecute(commandId: string) {
  void commandId;
  showCommandSheet.value = false;
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await loadData();
  pollInterval = setInterval(() => {
    void loadData();
  }, 5000);
});

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval);
});
</script>

<template>
  <div class="app-shell">
    <div v-if="error" class="error-banner">{{ error }}</div>

    <template v-if="selectedTask">
      <TaskScreen :task="selectedTask" @back="goBack" />
    </template>
    <template v-else>
      <MobileHeader
        :title="headerTitle"
        :subtitle="headerSubtitle"
        @search="openSearch"
        @create="openNewTask"
      />
      <TasksScreen
        v-if="currentTab === 'tasks'"
        :groups="taskGroups"
        @select="selectTask"
      />
      <RecentScreen
        v-else-if="currentTab === 'recent'"
        :tasks="recentTasks"
        @select="selectTask"
      />
      <RecentScreen
        v-else
        :tasks="recentTasks"
        @select="selectTask"
      />
    </template>

    <FloatingToolbar
      :current-tab="currentTab"
      @select="handleToolbarSelect"
    />
    <CommandPaletteSheet
      :visible="showCommandSheet"
      :title="commandSheetTitle"
      :commands="currentCommands"
      @close="showCommandSheet = false"
      @execute="handleCommandExecute"
    />
    <TaskSearchSheet
      :visible="showSearchSheet"
      :tasks="recentTasks"
      @close="showSearchSheet = false"
      @select="selectTask"
    />
  </div>
</template>

<style>
* { box-sizing: border-box; }

body {
  margin: 0;
  background:
    radial-gradient(circle at top, rgba(255, 234, 204, 0.65), transparent 30%),
    linear-gradient(180deg, #f8f3ea 0%, #efe7da 100%);
  color: #1e1b16;
  font-family: "SF Pro Text", "Helvetica Neue", sans-serif;
  font-size: 15px;
  -webkit-user-select: none;
  user-select: none;
}

button,
input {
  font: inherit;
}

.app-shell {
  min-height: 100dvh;
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

.error-banner {
  margin: 12px 16px 0;
  padding: 10px 12px;
  border: 1px solid rgba(170, 58, 43, 0.18);
  border-radius: 14px;
  background: rgba(143, 31, 31, 0.08);
  color: #8c2f25;
  font-size: 13px;
}

</style>
