<template>
  <div class="error-boundary">
    <slot />

    <!-- Toast notification container -->
    <Teleport to="body">
      <div class="error-toasts">
        <TransitionGroup name="toast">
          <div
            v-for="toast in toasts"
            :key="toast.id"
            :class="['error-toast', `error-toast--${toast.severity}`]"
          >
            <span class="error-toast__icon">{{ severityIcon(toast.severity) }}</span>
            <span class="error-toast__message">{{ toast.message }}</span>
            <button class="error-toast__close" @click="dismissToast(toast.id)">&#x2715;</button>
          </div>
        </TransitionGroup>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured, onMounted, onBeforeUnmount } from 'vue';

export type ErrorSeverity = 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  message: string;
  severity: ErrorSeverity;
}

const props = withDefaults(
  defineProps<{
    /** Auto-dismiss timeout in ms (0 = no auto-dismiss) */
    autoDismiss?: number;
  }>(),
  { autoDismiss: 5000 }
);

const emit = defineEmits<{
  (e: 'error', error: Error, severity: ErrorSeverity): void;
}>();

const toasts = ref<Toast[]>([]);
let nextId = 0;

function addToast(message: string, severity: ErrorSeverity = 'error') {
  const id = nextId++;
  toasts.value.push({ id, message, severity });

  if (props.autoDismiss > 0) {
    setTimeout(() => dismissToast(id), props.autoDismiss);
  }
}

function dismissToast(id: number) {
  toasts.value = toasts.value.filter(t => t.id !== id);
}

function severityIcon(severity: ErrorSeverity): string {
  switch (severity) {
    case 'error': return '\u26D4';
    case 'warning': return '\u26A0';
    case 'info': return '\u2139';
  }
}

// Capture Vue component errors
onErrorCaptured((err, instance, info) => {
  const message = err instanceof Error ? err.message : String(err);
  addToast(message, 'error');
  emit('error', err instanceof Error ? err : new Error(message), 'error');
  return false; // prevent propagation
});

// Global unhandled errors
function handleGlobalError(event: ErrorEvent) {
  addToast(event.message || 'An unexpected error occurred', 'error');
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  const msg = event.reason?.message || String(event.reason) || 'Unhandled promise rejection';
  addToast(msg, 'warning');
}

onMounted(() => {
  window.addEventListener('error', handleGlobalError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
});

onBeforeUnmount(() => {
  window.removeEventListener('error', handleGlobalError);
  window.removeEventListener('unhandledrejection', handleUnhandledRejection);
});

defineExpose({ addToast, dismissToast });
</script>

<style scoped>
.error-boundary { position: relative; }
.error-toasts {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 50000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 400px;
}
.error-toast {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  font-size: 13px;
  line-height: 1.4;
}
.error-toast--error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.error-toast--warning { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
.error-toast--info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
.error-toast__icon { flex-shrink: 0; font-size: 14px; }
.error-toast__message { flex: 1; }
.error-toast__close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.5;
  padding: 0;
  line-height: 1;
}
.error-toast__close:hover { opacity: 1; }

/* Transition animations */
.toast-enter-active { transition: all 0.3s ease-out; }
.toast-leave-active { transition: all 0.2s ease-in; }
.toast-enter-from { opacity: 0; transform: translateX(30px); }
.toast-leave-to { opacity: 0; transform: translateX(30px); }
</style>
