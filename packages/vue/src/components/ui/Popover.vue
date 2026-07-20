<!-- Shared dropdown wrapper: close-on-click-outside / Escape / scroll, plus
     a `position: fixed` panel placed from the trigger's rect so it escapes
     the formatting bar's `overflow-x: auto` clipping. -->
<template>
  <span ref="rootRef" class="docx-popover">
    <slot name="trigger" :toggle="toggle" :open="open" />
    <div
      v-if="open"
      ref="panelRef"
      class="docx-popover__panel"
      :class="panelClass"
      :style="[positionStyle, panelStyle ?? {}]"
      @mousedown.stop
    >
      <slot name="panel" />
    </div>
  </span>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, type CSSProperties } from 'vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** Where the panel sits relative to the trigger. Defaults to bottom-left. */
    placement?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
    /** Extra panel className. */
    panelClass?: string;
    /** Extra panel inline styles. */
    panelStyle?: CSSProperties;
    /** Close when the user scrolls outside the panel (default true). */
    closeOnScroll?: boolean;
  }>(),
  { placement: 'bottom-left', closeOnScroll: true }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:open', value: boolean): void;
}>();

const rootRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

const GAP = 4;
const positionStyle = ref<CSSProperties>({ position: 'fixed' });

function computePosition() {
  const el = rootRef.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const style: CSSProperties = { position: 'fixed' };
  if (props.placement.startsWith('top')) {
    style.bottom = `${Math.round(window.innerHeight - r.top + GAP)}px`;
    style.top = 'auto';
  } else {
    style.top = `${Math.round(r.bottom + GAP)}px`;
    style.bottom = 'auto';
  }
  if (props.placement.endsWith('right')) {
    style.right = `${Math.round(window.innerWidth - r.right)}px`;
    style.left = 'auto';
  } else {
    style.left = `${Math.round(r.left)}px`;
    style.right = 'auto';
  }
  positionStyle.value = style;
}

function toggle() {
  emit('update:open', !props.open);
  if (props.open) emit('close');
}

function close() {
  emit('update:open', false);
  emit('close');
}

function onClickOutside(e: MouseEvent) {
  if (!props.open) return;
  const target = e.target as Node;
  if (rootRef.value?.contains(target) || panelRef.value?.contains(target)) return;
  close();
}
function onEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close();
}
function onScroll(e: Event) {
  // Capture-phase listener: fires for descendant scrolls too. Scrolling
  // *inside* the panel (e.g. an overflow-y:auto menu) must not dismiss it.
  if (!props.closeOnScroll || !props.open) return;
  if (panelRef.value?.contains(e.target as Node)) return;
  close();
}
function onResize() {
  if (props.open) computePosition();
}

function addListeners() {
  document.addEventListener('mousedown', onClickOutside);
  document.addEventListener('keydown', onEscape);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onResize);
}
function removeListeners() {
  document.removeEventListener('mousedown', onClickOutside);
  document.removeEventListener('keydown', onEscape);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onResize);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      computePosition();
      addListeners();
    } else {
      removeListeners();
    }
  }
);
watch(
  () => props.placement,
  () => props.open && computePosition()
);

onMounted(() => {
  if (props.open) {
    computePosition();
    addListeners();
  }
});
onBeforeUnmount(removeListeners);
</script>

<style scoped>
.docx-popover {
  position: relative;
  display: inline-flex;
}
.docx-popover__panel {
  position: fixed;
  z-index: 10000;
  background: var(--doc-surface);
  /* Match React's dropdown/menu panels (MenuDropdown / EditingModeDropdown):
     --doc-border + a 12px-blur shadow. */
  border: 1px solid var(--doc-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px var(--doc-shadow);
}
</style>
