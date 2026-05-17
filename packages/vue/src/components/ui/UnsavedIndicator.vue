<template>
  <span v-if="hasUnsavedChanges" :class="['unsaved-indicator', `unsaved-indicator--${variant}`]" :title="title">
    <span v-if="variant === 'dot'" class="unsaved-indicator__dot" />
    <span v-else-if="variant === 'badge'" class="unsaved-indicator__badge">{{ changeCount }}</span>
    <span v-else class="unsaved-indicator__text">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';

const props = withDefaults(
  defineProps<{
    /** Current document state (JSON string or hash) for change detection */
    currentState?: string;
    /** Whether to warn on page unload */
    warnOnUnload?: boolean;
    /** Display variant */
    variant?: 'dot' | 'badge' | 'text';
    /** Label for text variant */
    label?: string;
    /** Title tooltip */
    title?: string;
  }>(),
  {
    warnOnUnload: true,
    variant: 'dot',
    label: 'Unsaved changes',
    title: 'You have unsaved changes',
  }
);

const hasUnsavedChanges = ref(false);
const changeCount = ref(0);
let savedState: string | null = null;

watch(() => props.currentState, (newState) => {
  if (newState === undefined) return;
  if (savedState === null) {
    savedState = newState;
    return;
  }
  if (newState !== savedState) {
    hasUnsavedChanges.value = true;
    changeCount.value++;
  }
});

function markAsSaved() {
  savedState = props.currentState ?? null;
  hasUnsavedChanges.value = false;
  changeCount.value = 0;
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (hasUnsavedChanges.value && props.warnOnUnload) {
    e.preventDefault();
    e.returnValue = '';
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload);
});

defineExpose({ hasUnsavedChanges, changeCount, markAsSaved });
</script>

<style scoped>
.unsaved-indicator { display: inline-flex; align-items: center; }
.unsaved-indicator__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.unsaved-indicator__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  background: #f59e0b;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  border-radius: 9px;
}
.unsaved-indicator__text {
  font-size: 12px;
  color: #f59e0b;
  font-weight: 500;
}
</style>
