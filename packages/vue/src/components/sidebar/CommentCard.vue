<template>
  <div :class="['comment-card', { 'comment-card--expanded': expanded, 'comment-card--resolved': comment.done }]" @mousedown.stop>
    <!-- Resolved badge -->
    <div v-if="comment.done" class="comment-card__resolved-badge">
      <span class="comment-card__resolved-icon">&#x2713;</span> Resolved
    </div>

    <!-- Header -->
    <div class="comment-card__header">
      <div class="comment-card__avatar" :style="{ backgroundColor: avatarColor }">
        {{ initials }}
      </div>
      <div class="comment-card__meta">
        <span class="comment-card__author">{{ comment.author }}</span>
        <span class="comment-card__date">{{ formattedDate }}</span>
      </div>
      <div v-if="expanded" class="comment-card__actions">
        <button
          v-if="comment.done"
          class="comment-card__action-btn"
          title="Unresolve"
          @mousedown.prevent="$emit('unresolve', comment.id)"
        >&#x21B6;</button>
        <button
          v-else
          class="comment-card__action-btn"
          title="Resolve"
          @mousedown.prevent="$emit('resolve', comment.id)"
        >&#x2713;</button>
        <button
          class="comment-card__action-btn"
          title="Delete"
          @mousedown.prevent="$emit('delete', comment.id)"
        >&#x2715;</button>
      </div>
    </div>

    <!-- Comment text -->
    <div class="comment-card__text">{{ commentText }}</div>

    <!-- Replies -->
    <template v-if="replies.length > 0">
      <div v-if="!expanded && replies.length > 0" class="comment-card__reply-count">
        {{ replies.length }} {{ replies.length === 1 ? 'reply' : 'replies' }}
      </div>
      <div v-if="expanded" class="comment-card__replies">
        <div v-for="reply in replies" :key="reply.id" class="comment-card__reply">
          <div class="comment-card__reply-header">
            <div class="comment-card__avatar comment-card__avatar--small" :style="{ backgroundColor: getAvatarColor(reply.author) }">
              {{ getInitials(reply.author) }}
            </div>
            <span class="comment-card__author">{{ reply.author }}</span>
            <span class="comment-card__date">{{ formatDate(reply.date) }}</span>
          </div>
          <div class="comment-card__reply-text">{{ getCommentText(reply.content) }}</div>
        </div>
      </div>
    </template>

    <!-- Reply input -->
    <div v-if="expanded && !comment.done" class="comment-card__reply-input">
      <input
        v-model="replyText"
        class="comment-card__input"
        placeholder="Reply..."
        @keydown.enter.prevent="submitReply"
      />
      <button
        class="comment-card__submit"
        :disabled="!replyText.trim()"
        @mousedown.prevent="submitReply"
      >&#x27A4;</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Comment } from '@eigenpal/docx-core/types/content';
import { getCommentText, formatDate, getInitials, getAvatarColor } from './sidebarUtils';

const props = defineProps<{
  comment: Comment;
  replies: Comment[];
  expanded: boolean;
}>();

const emit = defineEmits<{
  (e: 'reply', commentId: number, text: string): void;
  (e: 'resolve', commentId: number): void;
  (e: 'unresolve', commentId: number): void;
  (e: 'delete', commentId: number): void;
}>();

const replyText = ref('');

const initials = computed(() => getInitials(props.comment.author));
const avatarColor = computed(() => getAvatarColor(props.comment.author));
const formattedDate = computed(() => formatDate(props.comment.date));
const commentText = computed(() => getCommentText(props.comment.content));

function submitReply() {
  const text = replyText.value.trim();
  if (!text) return;
  emit('reply', props.comment.id, text);
  replyText.value = '';
}
</script>

<style scoped>
.comment-card {
  background: #f8fbff;
  border: 1px solid #e3eaf3;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
  cursor: pointer;
  transition: box-shadow 0.15s, background 0.15s;
}
.comment-card--expanded {
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  cursor: default;
}
.comment-card--resolved {
  opacity: 0.7;
}
.comment-card__resolved-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #e6f4ea;
  color: #137333;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 10px;
  margin-bottom: 6px;
}
.comment-card__resolved-icon { font-size: 10px; }
.comment-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.comment-card__avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}
.comment-card__avatar--small {
  width: 22px;
  height: 22px;
  font-size: 9px;
}
.comment-card__meta { flex: 1; min-width: 0; }
.comment-card__author { font-size: 12px; font-weight: 600; color: #1f2937; display: block; }
.comment-card__date { font-size: 11px; color: #9ca3af; }
.comment-card__actions { display: flex; gap: 2px; }
.comment-card__action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #6b7280;
}
.comment-card__action-btn:hover { background: #f3f4f6; }
.comment-card__text { font-size: 13px; color: #374151; line-height: 1.4; }
.comment-card__reply-count { font-size: 11px; color: #6b7280; margin-top: 6px; }
.comment-card__replies { margin-top: 8px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
.comment-card__reply { margin-bottom: 8px; }
.comment-card__reply-header { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.comment-card__reply-text { font-size: 12px; color: #4b5563; margin-left: 28px; }
.comment-card__reply-input {
  display: flex;
  gap: 4px;
  margin-top: 8px;
  border-top: 1px solid #e5e7eb;
  padding-top: 8px;
}
.comment-card__input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 12px;
  outline: none;
}
.comment-card__input:focus { border-color: #3b82f6; }
.comment-card__submit {
  width: 28px;
  height: 28px;
  border: none;
  background: #1a73e8;
  color: #fff;
  border-radius: 50%;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.comment-card__submit:disabled { background: #e5e7eb; color: #9ca3af; cursor: default; }
</style>
