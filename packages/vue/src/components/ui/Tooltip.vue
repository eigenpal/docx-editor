<!--
  Vue port of packages/react/src/components/ui/Tooltip.tsx — same
  delay (400ms default), same fixed-position bubble, same side
  options (top/bottom/left/right). Uses a single default slot for
  the trigger and a `content` prop for the tooltip body.
-->
<template>
  <span ref="triggerRef" class="docx-tooltip__trigger" @mouseenter="onEnter" @mouseleave="onLeave">
    <slot />
  </span>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="docx-tooltip"
      :style="bubbleStyle"
    >
      {{ content }}
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, type CSSProperties } from 'vue';

const props = withDefaults(
  defineProps<{
    content: string;
    side?: 'top' | 'bottom' | 'left' | 'right';
    delayMs?: number;
  }>(),
  { side: 'bottom', delayMs: 400 }
);

const isOpen = ref(false);
const position = ref({ x: 0, y: 0 });
const triggerRef = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

function onEnter() {
  timer = setTimeout(() => {
    const el = triggerRef.value;
    if (el) {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = props.side === 'top' ? r.top - 8 : r.bottom + 8;
      position.value = { x, y };
    }
    isOpen.value = true;
  }, props.delayMs);
}
function onLeave() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  isOpen.value = false;
}
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

const bubbleStyle = computed<CSSProperties>(() => ({
  left: position.value.x + 'px',
  top: position.value.y + 'px',
  transform:
    props.side === 'top'
      ? 'translate(-50%, -100%)'
      : props.side === 'bottom'
        ? 'translate(-50%, 0)'
        : undefined,
}));
</script>

<style scoped>
.docx-tooltip__trigger {
  display: inline-flex;
}
.docx-tooltip {
  position: fixed;
  z-index: 50;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--doc-on-primary);
  background: var(--doc-text);
  border-radius: 6px;
  box-shadow: 0 4px 6px -1px var(--doc-shadow);
  pointer-events: none;
}
</style>
