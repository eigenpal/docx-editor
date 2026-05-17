<!--
  Vue port of packages/react/src/plugins/template/components/TemplateChip.tsx —
  sidebar chip for a template tag. Rendered inside the UnifiedSidebar
  by the template plugin's getSidebarItems output. Same colour map +
  label semantics as React.
-->
<template>
  <div
    class="template-annotation-chip"
    :class="{ 'template-annotation-chip--hovered': isHovered }"
    :style="{ borderColor: color, background: isHovered ? color + '22' : 'transparent' }"
    @mouseenter="$emit('hover', tag.id)"
    @mouseleave="$emit('hover', undefined)"
    @click="$emit('select', tag.id)"
  >
    <span class="template-annotation-chip__name">
      <span class="template-annotation-chip__label" :style="{ color }">{{ label }}</span>
      {{ tag.name }}
    </span>
    <span v-if="tag.nestedVars && tag.nestedVars.length" class="template-annotation-chip__nested">
      {{ tag.nestedVars.join(', ') }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {
  TemplateTag,
  TagType,
} from '@eigenpal/docx-editor-core/prosemirror/template/prosemirror-plugin';

const props = defineProps<{
  tag: TemplateTag;
  isHovered?: boolean;
}>();

defineEmits<{
  (e: 'hover', id: string | undefined): void;
  (e: 'select', id: string): void;
}>();

const COLORS: Record<TagType, string> = {
  variable: '#f59e0b',
  sectionStart: '#3b82f6',
  sectionEnd: '#3b82f6',
  invertedStart: '#8b5cf6',
  raw: '#ef4444',
};

const color = computed(() => COLORS[props.tag.type]);
const label = computed(() => {
  switch (props.tag.type) {
    case 'sectionStart':
      return 'LOOP / IF';
    case 'invertedStart':
      return 'IF NOT';
    case 'raw':
      return 'HTML';
    default:
      return '';
  }
});
</script>

<style scoped>
.template-annotation-chip {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.template-annotation-chip__name {
  display: block;
}
.template-annotation-chip__label {
  font-size: 10px;
  font-weight: 600;
  margin-right: 6px;
  text-transform: uppercase;
}
.template-annotation-chip__nested {
  display: block;
  font-size: 11px;
  color: #6b7280;
  margin-top: 2px;
}
</style>
