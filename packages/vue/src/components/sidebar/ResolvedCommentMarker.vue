<!--
  Mirror of packages/react/src/components/sidebar/ResolvedCommentMarker.tsx.
  Tiny chat-bubble-with-check rendered in place of the full card for
  resolved threads in the sidebar. Click to expand back into the
  full thread.
-->
<template>
  <div
    class="resolved-comment-marker"
    :data-comment-id="comment.id"
    data-comment-resolved="true"
    @click="$emit('toggle-expand')"
    @mousedown.stop
  >
    <MaterialSymbol name="chat_bubble_check" :size="20" />
  </div>
</template>

<script setup lang="ts">
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import MaterialSymbol from '../ui/MaterialSymbol.vue';

defineProps<{
  comment: Comment;
}>();

defineEmits<{
  (e: 'toggle-expand'): void;
}>();
</script>

<style scoped>
.resolved-comment-marker {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  color: var(--doc-text-muted);
  padding: 2px;
  transition: opacity 0.15s ease;
}
.resolved-comment-marker:hover { opacity: 0.7; }
</style>
