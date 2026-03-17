<script setup lang="ts">
</script>

<template>
  <main class="app-shell">
    <h1>Kanna</h1>
    <p class="subtitle">Autonomous engineering team powered by Claude Code</p>
  </main>
</template>

<style>
:root {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  font-weight: 400;
  color: #e0e0e0;
  background-color: #1a1a1a;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  width: 100%;
}
</style>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
}

h1 {
  font-size: 28px;
  font-weight: 600;
  color: #f0f0f0;
}

.subtitle {
  font-size: 14px;
  color: #888;
}
</style>
