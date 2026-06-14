<!--
  Mirror of packages/react/src/components/sidebar/ReplyThread.tsx.
  Same structure: hidden-count summary line, then either the latest
  reply (collapsed) or all replies (expanded). Same colors, font
  sizes, spacing.
-->
<template>
  <div v-if="replies.length > 0" class="reply-thread">
    <div v-if="hiddenCount > 0" class="reply-thread__more">
      {{ hiddenCount }} {{ hiddenCount === 1 ? 'reply' : 'replies' }}
    </div>
    <div
      v-for="reply in visibleReplies"
      :key="reply.id"
      class="reply-thread__item"
      :class="{ 'reply-thread__item--expanded': isExpanded }"
    >
      <div class="reply-thread__header">
        <Avatar :name="reply.author" :size="28" />
        <div class="reply-thread__author-block">
          <div class="reply-thread__author">{{ reply.author || 'Unknown' }}</div>
          <div class="reply-thread__date">{{ formatDate(reply.date) }}</div>
        </div>
      </div>
      <div class="reply-thread__body" :class="{ 'reply-thread__body--clamp': !isExpanded }">
        {{ getCommentText(reply.content) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { getCommentText, formatDate } from './sidebarUtils';
import Avatar from './Avatar.vue';

const props = defineProps<{
  replies: Comment[];
  isExpanded: boolean;
}>();

const visibleReplies = computed(() =>
  props.isExpanded ? props.replies : props.replies.slice(-1)
);
const hiddenCount = computed(() =>
  props.isExpanded ? 0 : Math.max(0, props.replies.length - 1)
);
</script>

<style scoped>
.reply-thread { margin-top: 8px; }
.reply-thread__more {
  font-size: 12px;
  font-weight: 500;
  color: var(--doc-primary);
  padding: 6px 0;
  border-top: 1px solid var(--doc-border-light);
}
.reply-thread__item {
  padding-top: 8px;
  border-top: 1px solid var(--doc-border-light);
}
.reply-thread__item--expanded { margin-bottom: 8px; }
.reply-thread__header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.reply-thread__author-block { flex: 1; min-width: 0; }
.reply-thread__author {
  font-size: 13px;
  font-weight: 600;
  color: var(--doc-text);
}
.reply-thread__date {
  font-size: 11px;
  color: var(--doc-text-muted);
}
.reply-thread__body {
  font-size: 13px;
  color: var(--doc-text);
  line-height: 20px;
  margin-top: 4px;
}
.reply-thread__body--clamp {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
