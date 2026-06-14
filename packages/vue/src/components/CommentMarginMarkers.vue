<!--
  Mirror of packages/react/src/components/CommentMarginMarkers.tsx.
  Small chat-bubble icons at the page right edge — visible when the
  sidebar is closed; clicking opens the sidebar.

  Anchor positions are resolved DOM-side (querySelector on
  [data-comment-id="N"]) rather than via the React layout-engine
  anchorPositions Map, since the Vue adapter doesn't expose that.
  Same visual output, slightly different data path.
-->
<template>
  <div
    v-if="markers.length > 0"
    class="docx-comment-margin-markers"
    :style="containerStyle"
    @mousedown.stop
  >
    <button
      v-for="m in markers"
      :key="m.comment.id"
      class="docx-comment-margin-markers__btn"
      :title="m.isResolved ? 'Resolved comment' : 'Comment'"
      :style="{ top: m.y * zoom + 'px' }"
      @click="$emit('marker-click', m.comment.id)"
    >
      <MaterialSymbol
        :name="m.isResolved ? 'chat_bubble_check' : 'chat_bubble_outline'"
        :size="18"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import MaterialSymbol from './ui/MaterialSymbol.vue';

const props = defineProps<{
  comments: Comment[];
  pagesContainer: HTMLElement | null;
  zoom: number;
  pageWidthPx: number;
  sidebarOpen: boolean;
  resolvedCommentIds: Set<number>;
}>();

defineEmits<{
  (e: 'marker-click', commentId: number): void;
}>();

interface Marker {
  comment: Comment;
  isResolved: boolean;
  y: number;
}

const markers = computed<Marker[]>(() => {
  // Hide all markers when the sidebar is open — cards are visible
  // there instead. Matches React's CommentMarginMarkers semantics.
  if (props.sidebarOpen) return [];
  const container = props.pagesContainer;
  if (!container) return [];
  const containerRect = container.getBoundingClientRect();

  // Build a comment-id → element map in one querySelectorAll, then
  // look up by id (avoids N querySelectors per render).
  const els = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>('[data-comment-id]')) {
    const id = el.dataset.commentId;
    if (id && !els.has(id)) els.set(id, el);
  }

  const out: Marker[] = [];
  for (const c of props.comments) {
    if (c.parentId != null) continue;
    const anchor = els.get(String(c.id));
    if (!anchor) continue;
    const r = anchor.getBoundingClientRect();
    out.push({
      comment: c,
      isResolved: props.resolvedCommentIds.has(c.id),
      y: (r.top - containerRect.top + container.scrollTop) / props.zoom,
    });
  }
  return out;
});

// pageWidthPx is post-zoom; the marker container lives inside the
// scaled pages-viewport, so layout coords are unscaled. Divide
// zoom back out so the markers stay glued to the page right edge
// across zoom levels (mirrors UnifiedSidebar.vue's asideStyle).
const containerStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  top: 0,
  left: `calc(50% + ${(props.pageWidthPx / props.zoom) / 2 + 6}px)`,
  zIndex: 30,
  pointerEvents: 'none',
}));
</script>

<style scoped>
.docx-comment-margin-markers__btn {
  position: absolute;
  left: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
  color: var(--doc-text-muted);
  padding: 0;
  font-family: inherit;
  transition: opacity 0.15s ease;
}
.docx-comment-margin-markers__btn:hover { opacity: 0.7; }
</style>
