<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();

defineEmits<{
  search: [];
  create: [];
}>();
</script>

<template>
  <header class="mobile-header">
    <div class="header-copy">
      <p v-if="subtitle" class="subtitle">{{ subtitle }}</p>
      <h1>{{ title }}</h1>
    </div>
    <div class="header-actions">
      <button class="icon-button" type="button" @click="$emit('search')">⌕</button>
      <button class="icon-button" type="button" @click="$emit('create')">+</button>
    </div>
  </header>
</template>

<style scoped>
.mobile-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 16px 12px;
}

.header-copy h1 {
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.subtitle {
  margin-bottom: 4px;
  color: #7e7a70;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-button {
  width: 40px;
  height: 40px;
  border: 1px solid #d6cfc3;
  border-radius: 999px;
  background: rgba(255, 253, 248, 0.82);
  color: #332f28;
  font-size: 22px;
  line-height: 1;
}
</style>
