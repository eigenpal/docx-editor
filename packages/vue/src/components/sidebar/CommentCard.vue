<!--
  Mirror of packages/react/src/components/sidebar/CommentCard.tsx.
  Same card chrome (collapsed: #f8fbff bg + small shadow; expanded:
  white bg + larger shadow), same author/date/avatar layout, same
  resolved badge, same expanded-state actions (resolve/unresolve +
  more menu), same reply thread + reply input.
-->
<template>
  <div
    class="comment-card"
    :class="{ 'comment-card--expanded': expanded }"
    :data-comment-id="comment.id"
    @click="$emit('click')"
    @mousedown.stop
  >
    <div v-if="comment.done" class="comment-card__resolved">
      <MaterialSymbol name="check" :size="12" />
      <span>Resolved</span>
    </div>
    <div class="comment-card__head">
      <Avatar :name="comment.author" :size="32" />
      <div class="comment-card__author-block">
        <div class="comment-card__author">{{ comment.author || 'Unknown' }}</div>
        <div class="comment-card__date">{{ formatDate(comment.date) }}</div>
      </div>
      <div v-if="expanded" class="comment-card__actions">
        <button
          class="comment-card__icon-btn"
          :title="comment.done ? 'Reopen' : 'Resolve'"
          @click.stop="comment.done ? $emit('unresolve', comment.id) : $emit('resolve', comment.id)"
        >
          <MaterialSymbol :name="comment.done ? 'undo' : 'check'" :size="20" />
        </button>
        <button
          class="comment-card__icon-btn"
          title="More options"
          @click.stop="menuOpen = !menuOpen"
        >
          <MaterialSymbol name="more_vert" :size="20" />
        </button>
        <div
          v-if="menuOpen"
          class="comment-card__menu"
          @click.stop
          @mousedown.stop
        >
          <button
            class="comment-card__menu-item"
            @click="onDelete"
          >Delete</button>
        </div>
      </div>
    </div>

    <div class="comment-card__body">
      {{ getCommentText(comment.content) }}
    </div>

    <ReplyThread :replies="replies" :is-expanded="expanded" />

    <ReplyInput
      v-if="expanded && !comment.done"
      @submit="(text: string) => $emit('reply', comment.id, text)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { getCommentText, formatDate } from './sidebarUtils';
import MaterialSymbol from '../ui/MaterialSymbol.vue';
import Avatar from './Avatar.vue';
import ReplyThread from './ReplyThread.vue';
import ReplyInput from './ReplyInput.vue';

const props = defineProps<{
  comment: Comment;
  replies: Comment[];
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'reply', commentId: number, text: string): void;
  (e: 'resolve', commentId: number): void;
  (e: 'unresolve', commentId: number): void;
  (e: 'delete', commentId: number): void;
}>();

const menuOpen = ref(false);

function onDelete() {
  menuOpen.value = false;
  emit('delete', props.comment.id);
}
</script>

<style scoped>
/* Mirror React cardStyles.ts CARD_STYLE_COLLAPSED / CARD_STYLE_EXPANDED. */
.comment-card {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--doc-card);
  cursor: pointer;
  box-shadow: var(--doc-card-shadow);
  margin-bottom: 6px;
  transition: box-shadow 0.15s ease, background-color 0.15s ease, padding 0.15s ease;
}
/* Expanded card matches React CARD_STYLE_EXPANDED — plain white
   with a stronger drop shadow. The yellow visual link to the
   commented span is carried by the [data-comment-id] highlight
   boost in UnifiedSidebar.vue's expandedHighlightCss, not the card
   chrome. */
.comment-card--expanded {
  padding: 10px 12px;
  background: var(--doc-surface);
  box-shadow: var(--doc-card-shadow-strong);
}
.comment-card__resolved {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--doc-success);
  background: var(--doc-success-bg);
  border-radius: 10px;
}
.comment-card__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.comment-card__author-block {
  flex: 1;
  min-width: 0;
}
.comment-card__author {
  font-size: 13px;
  font-weight: 600;
  color: var(--doc-text);
}
.comment-card__date {
  font-size: 11px;
  color: var(--doc-text-muted);
}
.comment-card__actions {
  display: flex;
  gap: 4px;
  margin-top: 2px;
  position: relative;
}
.comment-card__icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--doc-text-muted);
  display: flex;
  border-radius: 50%;
}
.comment-card__icon-btn:hover {
  background: var(--doc-shadow-subtle);
}
.comment-card__menu {
  position: absolute;
  top: 32px;
  right: 0;
  background: var(--doc-surface);
  border-radius: 8px;
  box-shadow:
    0 2px 6px var(--doc-shadow-strong),
    0 1px 2px var(--doc-shadow);
  z-index: 100;
  min-width: 120px;
  padding: 4px 0;
}
.comment-card__menu-item {
  display: block;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: none;
  text-align: left;
  font-size: 14px;
  color: var(--doc-text);
  cursor: pointer;
  font-family: inherit;
}
.comment-card__menu-item:hover {
  background: var(--doc-bg-hover);
}
.comment-card__body {
  font-size: 13px;
  color: var(--doc-text);
  line-height: 20px;
  margin-top: 6px;
}
</style>
