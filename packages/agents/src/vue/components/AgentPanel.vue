<!--
  AgentPanel — dumb resizable right column for an agent UI (Vue twin of the
  React component at src/react/components/AgentPanel.tsx).

  Mirrors the React contract: the shell renders chrome (header, close
  button, drag-to-resize handle) and any chat primitives go in the default
  slot. When uncontrolled, drag width persists to localStorage. Pass `width`
  + `@update:width` to lift control into the consumer.
-->
<template>
  <div
    :class="['ep-agent-panel', className]"
    :style="rootStyle"
    :aria-hidden="closed"
    :aria-label="title"
    role="complementary"
    data-testid="agent-panel"
    :data-state="closed ? 'closed' : 'open'"
    @keydown.esc="onEscape"
  >
    <div
      role="separator"
      aria-orientation="vertical"
      :aria-label="resizeHandleLabel"
      :aria-valuenow="currentWidth"
      :aria-valuemin="minWidth"
      :aria-valuemax="maxWidth"
      :aria-valuetext="`${currentWidth} pixels wide`"
      tabindex="0"
      :style="handleStyle"
      data-testid="agent-panel-resize-handle"
      @pointerdown="onHandlePointerDown"
      @keydown="onHandleKeydown"
    />

    <div :style="headerStyle">
      <span :style="iconStyle">
        <slot name="icon">
          <svg
            viewBox="0 -960 960 960"
            width="22"
            height="22"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="m760-600-50-110-110-50 110-50 50-110 50 110 110 50-110 50-50 110Zm0 560-50-110-110-50 110-50 50-110 50 110 110 50-110 50-50 110ZM360-160 260-380 40-480l220-100 100-220 100 220 220 100-220 100-100 220Zm0-194 40-86 86-40-86-40-40-86-40 86-86 40 86 40 40 86Zm0-126Z" />
          </svg>
        </slot>
      </span>
      <span :style="titleStyle">{{ title }}</span>
      <button
        v-if="closable"
        type="button"
        :aria-label="closeLabel"
        :title="closeLabel"
        data-testid="agent-panel-close"
        :style="closeBtnStyle"
        @click="emit('close')"
        @mouseenter="onCloseHover(true, $event)"
        @mouseleave="onCloseHover(false, $event)"
      >
        <svg viewBox="0 -960 960 960" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path
            d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
          />
        </svg>
      </button>
    </div>

    <div :style="contentStyle">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import en from '../../../i18n/en.json';

const STORAGE_KEY = 'eigenpal:docx-editor:agentPanelWidth';
const DEFAULT_WIDTH = 360;
const DEFAULT_MIN = 280;
const DEFAULT_MAX = 600;

export interface AgentPanelProps {
  title?: string;
  closeLabel?: string;
  resizeHandleLabel?: string;
  width?: number;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  closed?: boolean;
  /**
   * Show the header close button. Vue parity for React's
   * `onClose=undefined → no button` pattern: pass `:closable="false"` to
   * hide. Defaults to `true` because Vue's `defineEmits` always declares
   * the `close` event regardless of whether the parent attached `@close`.
   */
  closable?: boolean;
  className?: string;
}

const props = withDefaults(defineProps<AgentPanelProps>(), {
  title: () => en.agentPanel.defaultTitle,
  closeLabel: () => en.agentPanel.close,
  resizeHandleLabel: () => en.agentPanel.resizeHandle,
  width: undefined,
  defaultWidth: DEFAULT_WIDTH,
  minWidth: DEFAULT_MIN,
  maxWidth: DEFAULT_MAX,
  closed: false,
  closable: true,
  className: '',
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:width', w: number): void;
}>();

const isControlled = computed(() => props.width !== undefined);

function readStoredWidth(): number {
  if (typeof window === 'undefined') return props.defaultWidth;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n) && n >= props.minWidth && n <= props.maxWidth) return n;
    }
  } catch {
    // localStorage may be blocked.
  }
  return props.defaultWidth;
}

const internalWidth = ref<number>(isControlled.value ? props.width! : readStoredWidth());
const currentWidth = computed(() => (isControlled.value ? props.width! : internalWidth.value));

// Transition `width` / `flex-basis` only during open/close — never during a
// drag, otherwise the visual width lags behind the user's pointer.
// `flush: 'post'` ensures the transition class lands AFTER the DOM update
// so the first frame paints with the transition active.
const closeTransitioning = ref(false);
let closeTimer: number | null = null;
watch(
  () => props.closed,
  () => {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTransitioning.value = true;
    closeTimer = window.setTimeout(() => {
      closeTransitioning.value = false;
      closeTimer = null;
    }, 260);
  },
  { flush: 'post' }
);

let dragState: { startX: number; startWidth: number; lastWidth: number } | null = null;

function onMove(e: PointerEvent) {
  if (!dragState) return;
  const delta = dragState.startX - e.clientX;
  const next = Math.min(props.maxWidth, Math.max(props.minWidth, dragState.startWidth + delta));
  dragState.lastWidth = next;
  if (!isControlled.value) internalWidth.value = next;
  emit('update:width', next);
}

function onUp() {
  if (!dragState) return;
  const last = dragState.lastWidth;
  dragState = null;
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', onUp);
  if (!isControlled.value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(last));
    } catch {
      // localStorage may be blocked.
    }
  }
}

function onHandlePointerDown(e: PointerEvent) {
  e.preventDefault();
  dragState = {
    startX: e.clientX,
    startWidth: currentWidth.value,
    lastWidth: currentWidth.value,
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// Only consume Escape when we're actually going to close — otherwise an
// outer modal wrapping the panel can still react to it.
function onEscape(e: KeyboardEvent) {
  if (!props.closable) return;
  e.stopPropagation();
  emit('close');
}

// WCAG 2.1.1 — keyboard-operable separator.
function onHandleKeydown(e: KeyboardEvent) {
  let delta = 0;
  let target: number | null = null;
  const step = e.shiftKey ? 64 : 16; // Shift = larger nudge
  switch (e.key) {
    case 'ArrowLeft':
      delta = step;
      break;
    case 'ArrowRight':
      delta = -step;
      break;
    case 'Home':
      target = props.maxWidth;
      break;
    case 'End':
      target = props.minWidth;
      break;
    default:
      return;
  }
  e.preventDefault();
  const next =
    target !== null
      ? target
      : Math.min(props.maxWidth, Math.max(props.minWidth, currentWidth.value + delta));
  if (!isControlled.value) internalWidth.value = next;
  emit('update:width', next);
  if (!isControlled.value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // localStorage may be blocked.
    }
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', onUp);
  if (closeTimer !== null) window.clearTimeout(closeTimer);
});

const rootStyle = computed(() => ({
  width: props.closed ? '0px' : `${currentWidth.value}px`,
  flex: props.closed ? '0 0 0px' : `0 0 ${currentWidth.value}px`,
  height: 'calc(100% - 16px)',
  margin: props.closed ? '8px 0 8px 0' : '8px 8px 8px 12px',
  display: 'flex',
  flexDirection: 'column' as const,
  background: '#ffffff',
  border: props.closed ? '1px solid transparent' : '1px solid #e3e3e3',
  borderRadius: '16px',
  boxShadow: props.closed
    ? 'none'
    : '0 1px 2px rgba(60,64,67,0.05), 0 4px 12px rgba(60,64,67,0.08)',
  opacity: props.closed ? 0 : 1,
  pointerEvents: (props.closed ? 'none' : 'auto') as 'none' | 'auto',
  position: 'relative' as const,
  boxSizing: 'border-box' as const,
  minWidth: props.closed ? 0 : `${props.minWidth}px`,
  overflow: 'hidden',
  fontFamily: "'Google Sans', 'Google Sans Text', system-ui, -apple-system, sans-serif",
  transition: closeTransitioning.value
    ? 'flex-basis 220ms cubic-bezier(0.4, 0, 0.2, 1), width 220ms cubic-bezier(0.4, 0, 0.2, 1), margin 220ms cubic-bezier(0.4, 0, 0.2, 1), opacity 180ms ease, box-shadow 220ms ease, border-color 220ms ease'
    : 'opacity 180ms ease, box-shadow 220ms ease, border-color 220ms ease',
}));

const handleStyle = {
  position: 'absolute' as const,
  left: '-3px',
  top: 0,
  bottom: 0,
  width: '6px',
  cursor: 'col-resize',
  touchAction: 'none' as const,
  zIndex: 1,
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '14px 16px 10px',
  flex: '0 0 auto',
  background: '#ffffff',
};

const iconStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  color: '#0b57d0',
};

const titleStyle = {
  flex: 1,
  fontSize: '15px',
  fontWeight: 500,
  color: '#1f1f1f',
  letterSpacing: '0.1px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
};

const closeBtnStyle = {
  border: 'none',
  background: 'transparent',
  padding: '6px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#444746',
  borderRadius: '999px',
  transition: 'background 0.15s',
};

const contentStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column' as const,
};

function onCloseHover(hovered: boolean, e: MouseEvent) {
  const t = e.currentTarget as HTMLButtonElement | null;
  if (!t) return;
  t.style.background = hovered ? '#f1f3f4' : 'transparent';
}
</script>
