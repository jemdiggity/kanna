import { onMounted, onUnmounted } from "vue";

export interface KeyboardActions {
  // Pipeline
  newTask: () => void;
  openFile: () => void;
  makePR: () => void;
  merge: () => void;
  closeTask: () => void;
  // Navigation
  navigateUp: () => void;
  navigateDown: () => void;
  toggleZen: () => void;
  exitZen: () => void;
  // Terminal
  openTerminal: () => void;
  openTerminalAtRoot: () => void;
  closeTerminal: () => void;
  nextTab: () => void;
  prevTab: () => void;
  // Window
  newWindow: () => void;
  // Help
  showShortcuts: () => void;
  openPreferences: () => void;
}

export function useKeyboardShortcuts(actions: KeyboardActions) {
  function handler(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;

    // Skip most shortcuts when typing in text fields
    const target = e.target as HTMLElement;
    const inInput = target.tagName === "TEXTAREA" || target.tagName === "INPUT";

    // Escape — always works
    if (e.key === "Escape") {
      actions.exitZen();
      return;
    }

    // Don't intercept shortcuts when typing in inputs (except Escape above)
    if (inInput) return;

    // Shift+Cmd+N → New Task
    if (meta && e.shiftKey && e.key === "N") {
      e.preventDefault();
      actions.newTask();
      return;
    }

    // Cmd+N → New Window
    if (meta && !e.shiftKey && e.key === "n") {
      e.preventDefault();
      actions.newWindow();
      return;
    }

    // Cmd+P → Open File
    if (meta && e.key === "p") {
      e.preventDefault();
      actions.openFile();
      return;
    }

    // Cmd+S → Make PR
    if (meta && !e.shiftKey && e.key === "s") {
      e.preventDefault();
      actions.makePR();
      return;
    }

    // Cmd+M → Merge PR
    if (meta && e.key === "m") {
      e.preventDefault();
      actions.merge();
      return;
    }

    // Cmd+Delete → Close/Reject
    if (meta && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      actions.closeTask();
      return;
    }

    // Option+Cmd+Down → Next Task
    if (meta && e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      actions.navigateDown();
      return;
    }

    // Option+Cmd+Up → Previous Task
    if (meta && e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      actions.navigateUp();
      return;
    }

    // Shift+Cmd+Z → Zen Mode
    if (meta && e.shiftKey && e.key === "Z") {
      e.preventDefault();
      actions.toggleZen();
      return;
    }

    // Cmd+T → Open Terminal
    if (meta && !e.shiftKey && e.key === "t") {
      e.preventDefault();
      actions.openTerminal();
      return;
    }

    // Shift+Cmd+T → Open Terminal at Repo Root
    if (meta && e.shiftKey && e.key === "T") {
      e.preventDefault();
      actions.openTerminalAtRoot();
      return;
    }

    // Cmd+W → Close Terminal
    if (meta && e.key === "w") {
      e.preventDefault();
      actions.closeTerminal();
      return;
    }

    // Option+Cmd+Right → Next Tab
    if (meta && e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      actions.nextTab();
      return;
    }

    // Option+Cmd+Left → Previous Tab
    if (meta && e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      actions.prevTab();
      return;
    }

    // Cmd+/ → Show Shortcuts
    if (meta && e.key === "/") {
      e.preventDefault();
      actions.showShortcuts();
      return;
    }

    // Cmd+, → Preferences
    if (meta && e.key === ",") {
      e.preventDefault();
      actions.openPreferences();
      return;
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", handler);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", handler);
  });
}
