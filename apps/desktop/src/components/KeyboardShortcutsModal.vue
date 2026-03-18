<script setup lang="ts">
const emit = defineEmits<{ (e: "close"): void }>();

const groups = [
  {
    title: "Pipeline",
    shortcuts: [
      { keys: "Shift+Cmd+N", action: "New Task" },
      { keys: "Cmd+P", action: "Open File" },
      { keys: "Cmd+S", action: "Make PR" },
      { keys: "Cmd+M", action: "Merge PR" },
      { keys: "Cmd+Delete", action: "Close / Reject" },
    ],
  },
  {
    title: "Navigation",
    shortcuts: [
      { keys: "Option+Cmd+Down", action: "Next Task" },
      { keys: "Option+Cmd+Up", action: "Previous Task" },
      { keys: "Shift+Cmd+Z", action: "Zen Mode" },
      { keys: "Escape", action: "Exit Zen Mode" },
    ],
  },
  {
    title: "Terminal",
    shortcuts: [
      { keys: "Cmd+T", action: "Open Terminal" },
      { keys: "Shift+Cmd+T", action: "Terminal at Repo Root" },
      { keys: "Cmd+W", action: "Close Terminal" },
      { keys: "Option+Cmd+Right", action: "Next Tab" },
      { keys: "Option+Cmd+Left", action: "Previous Tab" },
    ],
  },
  {
    title: "Window",
    shortcuts: [
      { keys: "Cmd+N", action: "New Window" },
    ],
  },
  {
    title: "Help",
    shortcuts: [
      { keys: "Cmd+/", action: "Keyboard Shortcuts" },
      { keys: "Cmd+,", action: "Preferences" },
    ],
  },
];
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')" @keydown.escape="emit('close')">
    <div class="modal shortcuts-modal">
      <h3>Keyboard Shortcuts</h3>
      <div class="shortcuts-grid">
        <div v-for="group in groups" :key="group.title" class="shortcut-group">
          <h4>{{ group.title }}</h4>
          <div v-for="s in group.shortcuts" :key="s.keys" class="shortcut-row">
            <span class="shortcut-action">{{ s.action }}</span>
            <kbd>{{ s.keys }}</kbd>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.shortcuts-modal {
  background: #252525;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 20px;
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
}
h3 { margin: 0 0 16px; font-size: 15px; font-weight: 600; }
.shortcut-group { margin-bottom: 16px; }
h4 { color: #888; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px; }
.shortcut-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 13px; }
.shortcut-action { color: #ccc; }
kbd { background: #333; border: 1px solid #555; border-radius: 3px; padding: 1px 6px; font-family: "SF Mono", monospace; font-size: 11px; color: #aaa; }
.modal-footer { display: flex; justify-content: flex-end; margin-top: 12px; }
.btn { padding: 5px 14px; background: #333; border: 1px solid #444; border-radius: 4px; color: #ccc; cursor: pointer; font-size: 12px; }
</style>
