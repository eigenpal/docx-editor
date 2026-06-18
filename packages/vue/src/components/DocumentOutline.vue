<!--
  Vue document outline panel — mirrors React's `<DocumentOutline>`
  (DocumentOutline.tsx). Slides in from the left edge of the viewport,
  overlays the editor without consuming layout space, uses the same
  240px width / arrow_back icon / title text / empty-state copy as
  React so the two adapters look identical.
-->
<template>
  <nav
    v-if="isOpen"
    class="doc-outline"
    :style="{ left: leftOffset + 'px', top: topPx + 'px' }"
    role="navigation"
    aria-label="Document outline"
    @mousedown.stop
  >
    <div class="doc-outline__header">
      <button
        class="doc-outline__back"
        :title="'Close outline'"
        :aria-label="'Close outline'"
        @click="$emit('close')"
      >
        <MaterialSymbol name="arrow_back" :size="20" />
      </button>
      <span class="doc-outline__title">Document Outline</span>
    </div>
    <div class="doc-outline__body">
      <div v-if="headings.length === 0" class="doc-outline__empty">No headings found</div>
      <button
        v-for="(h, i) in headings"
        :key="i"
        class="doc-outline__item"
        :style="{ paddingLeft: 8 + (h.level - minLevel) * 16 + 'px' }"
        @mousedown.prevent="$emit('navigate', h.pmPos)"
      >
        {{ h.text || '(untitled)' }}
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { HeadingInfo } from '@eigenpal/docx-editor-core/utils/headingCollector';
import MaterialSymbol from './ui/MaterialSymbol.vue';

const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    headings: HeadingInfo[];
    /** Left anchor (px); host bumps it past the vertical ruler when shown. */
    leftOffset?: number;
    /** Top anchor (px); host bumps it past the sticky ruler row when shown. */
    topPx?: number;
  }>(),
  { leftOffset: 12, topPx: 24 }
);

// Indent relative to the shallowest heading present (mirrors React) so a doc
// whose top sections are Heading 2 doesn't carry a phantom first-level indent.
const minLevel = computed(() =>
  props.headings.length ? Math.min(...props.headings.map((h) => h.level)) : 0
);

defineEmits<{
  (e: 'close'): void;
  (e: 'navigate', pmPos: number): void;
}>();
</script>

<style scoped>
/* Matches React DocumentOutline.tsx: position: absolute against the
   editor host, anchored 12px from the left (= the collapsed toggle's
   offset so the back arrow lands where the toggle was), 240px wide,
   full height. The wrapping `__editor-area` has position: relative so
   this lands on top of the page area without consuming flex space. The
   slide-in uses transform so it doesn't trigger layout. */
.doc-outline {
  position: absolute;
  /* `left` and `top` are set inline by the host: `left` via the leftOffset prop
     (page left anchor, bumped when the vertical ruler is shown), `top` at the
     page top edge, bumped past the sticky ruler row when one is shown. */
  bottom: 0;
  width: 240px;
  display: flex;
  flex-direction: column;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  z-index: 40;
  animation: docOutlineIn 0.15s ease-out;
}
@keyframes docOutlineIn {
  /* Large enough to fully hide the 240px panel at any left anchor (12 or,
     when the vertical ruler is shown, 32 → right edge 272). */
  from {
    transform: translateX(-300px);
  }
  to {
    transform: translateX(0);
  }
}
/* No left padding so the back arrow sits at the nav anchor (= the
   collapsed toggle's position). */
.doc-outline__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 16px 12px 0;
}
.doc-outline__back {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  color: var(--doc-text-muted);
}
.doc-outline__back:hover {
  background: var(--doc-shadow-subtle);
}
.doc-outline__title {
  font-weight: 400;
  font-size: 14px;
  color: var(--doc-text);
  letter-spacing: 0.01em;
}
.doc-outline__body {
  flex: 1;
  overflow-y: auto;
  padding-left: 4px;
}
.doc-outline__empty {
  padding: 8px 16px;
  color: var(--doc-text-subtle);
  font-size: 13px;
  line-height: 20px;
}
.doc-outline__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--doc-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 4px;
}
.doc-outline__item:hover {
  background: var(--doc-shadow-subtle);
}
</style>
