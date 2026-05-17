<!--
  Vue port of packages/react/src/plugins/template/components/
  TemplateHighlightOverlay.tsx — highlight rectangle painted on
  top of the rendered pages for the currently-hovered template tag.
  Anchors to a tag's [data-tag-id] element in the pages container.
-->
<template>
  <div
    v-if="rect"
    class="template-highlight-overlay"
    :style="{
      left: rect.x + 'px',
      top: rect.y + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      borderColor: color,
      background: color + '22',
    }"
  />
</template>

<script setup lang="ts">
import { ref, watch, type Ref } from 'vue';
import type {
  TemplateTag,
  TagType,
} from '@eigenpal/docx-editor-core/prosemirror/template/prosemirror-plugin';

const props = defineProps<{
  tag: TemplateTag | null;
  pagesContainer: HTMLElement | null;
}>();

const COLORS: Record<TagType, string> = {
  variable: '#f59e0b',
  sectionStart: '#3b82f6',
  sectionEnd: '#3b82f6',
  invertedStart: '#8b5cf6',
  raw: '#ef4444',
};

const rect = ref<{ x: number; y: number; width: number; height: number } | null>(null);
const color = ref('#f59e0b');

function compute() {
  rect.value = null;
  const tag = props.tag;
  const container = props.pagesContainer;
  if (!tag || !container) return;
  color.value = COLORS[tag.type];
  const el = container.querySelector<HTMLElement>(`[data-tag-id="${tag.id}"]`);
  if (!el) return;
  const cr = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  rect.value = {
    x: r.left - cr.left + container.scrollLeft,
    y: r.top - cr.top + container.scrollTop,
    width: r.width,
    height: r.height,
  };
}

watch(() => [props.tag, props.pagesContainer], () => compute(), { immediate: true });
</script>

<style scoped>
.template-highlight-overlay {
  position: absolute;
  border: 2px solid;
  border-radius: 3px;
  pointer-events: none;
  z-index: 10;
  transition: top 0.1s ease, left 0.1s ease;
}
</style>
