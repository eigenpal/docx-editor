<template>
  <div role="radiogroup" aria-label="Color theme" class="theme-toggle" @mousedown.stop>
    <button
      v-for="opt in options"
      :key="opt.mode"
      type="button"
      role="radio"
      :aria-checked="value === opt.mode"
      :title="`${opt.label} mode`"
      :class="value === opt.mode ? 'opt opt--selected' : 'opt'"
      @click="emit('update:value', opt.mode)"
    >
      <span v-html="opt.icon" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  value: 'light' | 'dark';
}>();

const emit = defineEmits<{
  'update:value': [mode: 'light' | 'dark'];
}>();

const sun =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const moon =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

const options = [
  { mode: 'light' as const, label: 'Light', icon: sun },
  { mode: 'dark' as const, label: 'Dark', icon: moon },
];
</script>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 9999px;
  border: 1px solid var(--doc-border);
  background: var(--doc-bg-subtle);
}
.opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 9999px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  background: transparent;
  color: var(--doc-text-subtle);
}
.opt--selected {
  background: var(--doc-surface);
  box-shadow: 0 1px 2px var(--doc-shadow-subtle);
  color: var(--doc-text);
}
</style>
