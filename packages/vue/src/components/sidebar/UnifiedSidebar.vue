<template>
  <div v-if="isOpen" class="unified-sidebar">
    <div class="unified-sidebar__header">
      <span class="unified-sidebar__title">Comments & Changes</span>
      <button class="unified-sidebar__close" @click="$emit('close')">&#x2715;</button>
    </div>
    <div class="unified-sidebar__body">
      <!-- Add comment card -->
      <AddCommentCard
        v-if="isAddingComment"
        @submit="(text: string) => $emit('add-comment', text)"
        @cancel="$emit('cancel-add-comment')"
      />

      <!-- No items -->
      <div v-if="sortedItems.length === 0 && !isAddingComment" class="unified-sidebar__empty">
        No comments or changes
      </div>

      <!-- Comment cards -->
      <template v-for="item in sortedItems" :key="item.id">
        <CommentCard
          v-if="item.kind === 'comment'"
          :comment="item.comment!"
          :replies="item.replies!"
          :expanded="expandedId === item.id"
          @click="toggleExpanded(item.id)"
          @reply="(id: number, text: string) => $emit('comment-reply', id, text)"
          @resolve="(id: number) => $emit('comment-resolve', id)"
          @unresolve="(id: number) => $emit('comment-unresolve', id)"
          @delete="(id: number) => $emit('comment-delete', id)"
        />
        <TrackedChangeCard
          v-else-if="item.kind === 'tracked-change'"
          :change="item.change!"
          :expanded="expandedId === item.id"
          @click="toggleExpanded(item.id)"
          @accept="(from: number, to: number) => $emit('accept-change', from, to)"
          @reject="(from: number, to: number) => $emit('reject-change', from, to)"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Comment } from '@eigenpal/docx-core/types/content';
import type { TrackedChangeEntry } from './sidebarUtils';
import CommentCard from './CommentCard.vue';
import TrackedChangeCard from './TrackedChangeCard.vue';
import AddCommentCard from './AddCommentCard.vue';

interface SidebarItem {
  id: string;
  kind: 'comment' | 'tracked-change';
  anchorPos: number;
  comment?: Comment;
  replies?: Comment[];
  change?: TrackedChangeEntry;
}

const props = defineProps<{
  isOpen: boolean;
  comments: Comment[];
  trackedChanges: TrackedChangeEntry[];
  isAddingComment?: boolean;
  showResolved?: boolean;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'add-comment', text: string): void;
  (e: 'cancel-add-comment'): void;
  (e: 'comment-reply', commentId: number, text: string): void;
  (e: 'comment-resolve', commentId: number): void;
  (e: 'comment-unresolve', commentId: number): void;
  (e: 'comment-delete', commentId: number): void;
  (e: 'accept-change', from: number, to: number): void;
  (e: 'reject-change', from: number, to: number): void;
}>();

const expandedId = ref<string | null>(null);

function toggleExpanded(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

const sortedItems = computed<SidebarItem[]>(() => {
  const items: SidebarItem[] = [];

  // Build comment threads (top-level only, with replies grouped)
  const topLevelComments = props.comments.filter(c => !c.parentId);
  const replyMap = new Map<number, Comment[]>();
  for (const c of props.comments) {
    if (c.parentId != null) {
      const arr = replyMap.get(c.parentId) || [];
      arr.push(c);
      replyMap.set(c.parentId, arr);
    }
  }

  for (const comment of topLevelComments) {
    if (comment.done && !props.showResolved) continue;
    items.push({
      id: `comment-${comment.id}`,
      kind: 'comment',
      anchorPos: comment.id, // approximate sort order
      comment,
      replies: replyMap.get(comment.id) || [],
    });
  }

  // Tracked changes
  for (let i = 0; i < props.trackedChanges.length; i++) {
    const change = props.trackedChanges[i];
    items.push({
      id: `tc-${change.revisionId}-${i}`,
      kind: 'tracked-change',
      anchorPos: change.from,
      change,
    });
  }

  // Sort by document position
  items.sort((a, b) => a.anchorPos - b.anchorPos);
  return items;
});
</script>

<style scoped>
.unified-sidebar {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 320px;
  background: #f9fafb;
  border-left: 1px solid #e2e8f0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  box-shadow: -2px 0 8px rgba(0,0,0,0.08);
  animation: slideInRight 0.15s ease-out;
}
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
.unified-sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}
.unified-sidebar__title { font-weight: 600; font-size: 13px; color: #1f2937; }
.unified-sidebar__close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: #6b7280;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.unified-sidebar__close:hover { background: #f3f4f6; }
.unified-sidebar__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.unified-sidebar__empty {
  padding: 24px 16px;
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
}
</style>
