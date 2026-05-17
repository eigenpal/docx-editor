<!--
  UnifiedSidebar — anchored cards next to the rendered document.
  Mirrors React's UnifiedSidebar.tsx visual model: cards live in a
  fixed-width column to the right of the page, each card sits at the
  Y of its corresponding [data-comment-id] / .docx-insertion span.
  Falls back to stacked layout when an anchor can't be resolved (e.g.
  the layout-painter hasn't finished rendering yet) — cards still
  show up rather than going invisible.
-->
<template>
  <!-- Dynamic style boost for the focused/expanded item — same
       approach React's DocxEditor.tsx:5029-5044 takes. Injected as
       a sibling so the !important overrides win against the base
       editor.css highlight rules without touching DOM nodes. -->
  <component v-if="expandedHighlightCss" :is="'style'">{{ expandedHighlightCss }}</component>
  <aside
    v-if="isOpen"
    ref="rootRef"
    class="unified-sidebar"
    :style="asideStyle"
    @mousedown.stop
  >
    <div
      class="unified-sidebar__inner"
      :style="{ minHeight: minHeightPx + 'px' }"
    >
      <div
        v-if="isAddingComment"
        class="unified-sidebar__addcomment"
        :style="addCommentSlotStyle"
      >
        <AddCommentCard
          @submit="(text: string) => $emit('add-comment', text)"
          @cancel="$emit('cancel-add-comment')"
        />
      </div>

      <template v-for="item in sortedItems" :key="item.id">
        <div
          class="unified-sidebar__card-slot"
          :data-card-id="item.id"
          :style="cardSlotStyle(item.id)"
        >
          <!-- Resolved + collapsed comments render as a small
               chat-bubble-check marker (matches React's
               useCommentSidebarItems.tsx:96-98). Click expands into
               the full card. -->
          <ResolvedCommentMarker
            v-if="item.kind === 'comment' && item.comment!.done && expandedId !== item.id"
            :comment="item.comment!"
            @toggle-expand="toggleExpanded(item.id)"
          />
          <CommentCard
            v-else-if="item.kind === 'comment'"
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
            @reply="(rev: number, text: string) => $emit('tracked-change-reply', rev, text)"
          />
        </div>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { TrackedChangeEntry } from './sidebar/sidebarUtils';
import CommentCard from './sidebar/CommentCard.vue';
import ResolvedCommentMarker from './sidebar/ResolvedCommentMarker.vue';
import TrackedChangeCard from './sidebar/TrackedChangeCard.vue';
import AddCommentCard from './sidebar/AddCommentCard.vue';

import {
  MIN_CARD_GAP,
  SIDEBAR_DOCUMENT_SHIFT,
} from '@eigenpal/docx-editor-core/utils/sidebarConstants';

interface SidebarItem {
  id: string;
  kind: 'comment' | 'tracked-change';
  anchorSelector: string;
  fallbackOrder: number;
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
  pagesContainer: HTMLElement | null;
  pageWidthPx: number;
  zoom?: number;
  /** Controlled expand: when set, overrides local click toggling.
   *  Used by DocxEditorVue to auto-expand cards when the cursor
   *  lands on a commented / tracked span (mirrors React
   *  DocxEditor.tsx:5080-5118 cursorSidebarItem detection). */
  activeItemId?: string | null;
  /** Y (in unscaled coords inside the pages-viewport) where the
   *  AddCommentCard should anchor — mirrors React's
   *  addCommentYPosition pass-through. Null = top of rail. */
  addCommentYPosition?: number | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add-comment', text: string): void;
  (e: 'cancel-add-comment'): void;
  (e: 'comment-reply', commentId: number, text: string): void;
  (e: 'comment-resolve', commentId: number): void;
  (e: 'comment-unresolve', commentId: number): void;
  (e: 'comment-delete', commentId: number): void;
  (e: 'accept-change', from: number, to: number): void;
  (e: 'reject-change', from: number, to: number): void;
  (e: 'tracked-change-reply', revisionId: number, text: string): void;
  (e: 'update:activeItemId', id: string | null): void;
}>();

// Local fallback for uncontrolled use; when `activeItemId` is bound
// from the parent (DocxEditorVue) the prop wins and toggleExpanded
// emits up so the parent can update its own state.
const localExpanded = ref<string | null>(null);
const expandedId = computed<string | null>(() =>
  props.activeItemId !== undefined ? props.activeItemId : localExpanded.value
);

function toggleExpanded(id: string) {
  const next = expandedId.value === id ? null : id;
  localExpanded.value = next;
  emit('update:activeItemId', next);
}

const sortedItems = computed<SidebarItem[]>(() => {
  const items: SidebarItem[] = [];
  const topLevelComments = props.comments.filter((c) => !c.parentId);
  const replyMap = new Map<number, Comment[]>();
  for (const c of props.comments) {
    if (c.parentId != null) {
      const arr = replyMap.get(c.parentId) || [];
      arr.push(c);
      replyMap.set(c.parentId, arr);
    }
  }

  let order = 0;
  for (const comment of topLevelComments) {
    if (comment.done && !props.showResolved) continue;
    items.push({
      id: `comment-${comment.id}`,
      kind: 'comment',
      anchorSelector: `[data-comment-id="${comment.id}"]`,
      fallbackOrder: order++,
      comment,
      replies: replyMap.get(comment.id) || [],
    });
  }

  for (let i = 0; i < props.trackedChanges.length; i++) {
    const change = props.trackedChanges[i];
    const insRev = change.insertionRevisionId ?? change.revisionId;
    const sel =
      change.type === 'deletion'
        ? `.docx-deletion[data-revision-id="${change.revisionId}"]`
        : `.docx-insertion[data-revision-id="${insRev}"]`;
    items.push({
      id: `tc-${change.revisionId}-${i}`,
      kind: 'tracked-change',
      anchorSelector: sel,
      fallbackOrder: order++,
      change,
    });
  }
  return items;
});

// Resolved Y per item id. Recomputed on tick changes (manual recompute,
// ResizeObserver firing, watch on items length). Falls back to stacked
// layout when an anchor isn't found yet.
const rootRef = ref<HTMLElement | null>(null);
const resolvedY = ref<Map<string, number>>(new Map());
let resizeObserver: ResizeObserver | null = null;

function computePositions() {
  const container = props.pagesContainer;
  const items = sortedItems.value;
  if (!container || items.length === 0) {
    resolvedY.value = new Map();
    return;
  }

  // ONE batched DOM read: build maps for comments/insertions/deletions
  // up front, then look each item up by id rather than running N
  // querySelectors per recompute.
  const containerRect = container.getBoundingClientRect();
  const commentEls = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>('[data-comment-id]')) {
    const id = el.dataset.commentId;
    if (id && !commentEls.has(id)) commentEls.set(id, el);
  }
  const insertionEls = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>('.docx-insertion[data-revision-id]')) {
    const id = el.dataset.revisionId;
    if (id && !insertionEls.has(id)) insertionEls.set(id, el);
  }
  const deletionEls = new Map<string, HTMLElement>();
  for (const el of container.querySelectorAll<HTMLElement>('.docx-deletion[data-revision-id]')) {
    const id = el.dataset.revisionId;
    if (id && !deletionEls.has(id)) deletionEls.set(id, el);
  }

  const positioned: { id: string; targetY: number }[] = [];
  for (const item of items) {
    let anchor: HTMLElement | undefined;
    if (item.kind === 'comment') {
      anchor = commentEls.get(String(item.comment!.id));
    } else if (item.change!.type === 'deletion') {
      anchor = deletionEls.get(String(item.change!.revisionId));
    } else {
      const insRev = item.change!.insertionRevisionId ?? item.change!.revisionId;
      anchor = insertionEls.get(String(insRev));
    }
    if (!anchor) continue;
    const r = anchor.getBoundingClientRect();
    positioned.push({
      id: item.id,
      targetY: r.top - containerRect.top + container.scrollTop,
    });
  }
  positioned.sort((a, b) => a.targetY - b.targetY);

  // Card-height lookup: also batched into one querySelectorAll.
  const heights = new Map<string, number>();
  const root = rootRef.value;
  if (root) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const id = el.dataset.cardId;
      if (id) heights.set(id, el.offsetHeight);
    }
  }

  const map = new Map<string, number>();
  let lastBottom = 0;
  for (const p of positioned) {
    const h = heights.get(p.id) ?? 80;
    const y = Math.max(p.targetY, lastBottom + MIN_CARD_GAP);
    map.set(p.id, y);
    lastBottom = y + h;
  }
  resolvedY.value = map;
}

const minHeightPx = computed(() => {
  let max = 0;
  for (const y of resolvedY.value.values()) max = Math.max(max, y);
  return max + 200; // headroom for the bottom card
});

// Sidebar lives inside the pages-viewport but is a SIBLING of the
// scaled `__pages` container — so it is NOT itself scaled. The page
// renders at its visible (post-zoom) width, AND the page is shifted
// left by SIDEBAR_DOCUMENT_SHIFT whenever the sidebar is open
// (DocxEditorVue applies translateX on `__pages`). The sidebar must
// sit at `50% - SIDEBAR_DOCUMENT_SHIFT + visibleHalfPage + gap` so
// it tracks the shifted page right-edge — using `50% + halfPage` (the
// stale calc) put the rail ~352px past the page edge whenever the
// shift was active.
const SIDEBAR_GAP = 16;
const SIDEBAR_WIDTH = 300;
// Dynamic CSS boost for the expanded item. Mirrors React
// DocxEditor.tsx:5029-5044: brighten the comment-anchor highlight
// (yellow) for the focused comment, and the tracked-change
// insertion/deletion spans for the focused tc card.
const expandedHighlightCss = computed(() => {
  const id = expandedId.value;
  if (!id) return '';
  if (id.startsWith('comment-')) {
    const cid = id.slice('comment-'.length);
    return `.paged-editor__pages [data-comment-id="${cid}"] { background-color: rgba(255, 212, 0, 0.35) !important; border-bottom: 2px solid rgba(255, 212, 0, 0.7) !important; }`;
  }
  if (id.startsWith('tc-')) {
    // id shape: tc-<revisionId>-<index>
    const parts = id.split('-');
    const revId = parts[1];
    const item = sortedItems.value.find((s) => s.id === id);
    const insRev = item?.change?.insertionRevisionId ?? Number(revId);
    return `
      .paged-editor__pages .docx-insertion[data-revision-id="${insRev}"] { background-color: rgba(52, 168, 83, 0.2) !important; border-bottom: 2px solid #2e7d32 !important; }
      .paged-editor__pages .docx-deletion[data-revision-id="${revId}"] { background-color: rgba(211, 47, 47, 0.2) !important; text-decoration-thickness: 2px !important; }
    `;
  }
  return '';
});

const addCommentSlotStyle = computed(() => {
  const y = props.addCommentYPosition;
  if (y == null) {
    return { position: 'static' as const, marginBottom: '8px' };
  }
  return {
    position: 'absolute' as const,
    top: y + 'px',
    left: 0,
    right: 0,
    transition: 'top 0.15s ease',
  };
});

const asideStyle = computed(() => {
  // `props.pageWidthPx` is already post-zoom (twipsToPixels * zoom).
  // Sidebar sits outside the page transform, so half-visible-page is
  // just pageWidthPx / 2. Subtract SIDEBAR_DOCUMENT_SHIFT because the
  // page itself is translated left by that amount when the sidebar is
  // open — without the subtraction, the rail floats `2 *
  // SIDEBAR_DOCUMENT_SHIFT` (~352px) beyond the visible right edge.
  const halfPageVisible = props.pageWidthPx / 2;
  const offset = halfPageVisible + SIDEBAR_GAP - SIDEBAR_DOCUMENT_SHIFT;
  // Mirrors React UnifiedSidebar.tsx:202 — opacity 1 only once any
  // card position has resolved, so the rail fades in cleanly
  // instead of blinking blank.
  const hasPositions = resolvedY.value.size > 0 || sortedItems.value.length === 0;
  return {
    position: 'absolute' as const,
    top: '0',
    left: `calc(50% + ${offset}px)`,
    width: SIDEBAR_WIDTH + 'px',
    opacity: hasPositions ? 1 : 0,
  };
});

function cardSlotStyle(id: string) {
  const y = resolvedY.value.get(id);
  if (y == null) {
    // Fall back to stacked layout: card flows naturally below the
    // previous one, fully visible (NOT opacity 0). The user always
    // sees comments even when anchor measurement hasn't settled.
    return {
      position: 'static' as const,
      marginBottom: '8px',
    };
  }
  return {
    position: 'absolute' as const,
    top: y + 'px',
    left: 0,
    right: 0,
    transition: 'top 0.15s ease',
  };
}

// Schedule a single recompute on the next animation frame, coalesced.
let scheduled = false;
function recompute() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    computePositions();
  });
}

// Items / expand state / container / zoom changes all bump positions
// on the next animation frame. Zoom matters because the page is
// `transform: scale(zoom)` and `getBoundingClientRect` returns
// post-transform coords, so a zoom change shifts every anchor.
watch(
  () => [
    sortedItems.value.length,
    expandedId.value,
    props.pagesContainer,
    props.pageWidthPx,
    props.zoom,
  ],
  () => recompute(),
  { immediate: true }
);

// Find the closest scrolling ancestor of pagesContainer — usually the
// pages-viewport — so we can re-run computePositions whenever the user
// scrolls. Without this listener cards stay at their stale absolute Y
// while anchors move with the scrolled content; comments visibly drift
// out of sync as the user scrolls.
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const overflowY = getComputedStyle(cur).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return cur;
    cur = cur.parentElement;
  }
  return null;
}

let scrollParent: HTMLElement | null = null;
function bindScrollListener() {
  if (scrollParent) scrollParent.removeEventListener('scroll', recompute);
  scrollParent = findScrollParent(props.pagesContainer);
  if (scrollParent) {
    scrollParent.addEventListener('scroll', recompute, { passive: true });
  }
}

onMounted(() => {
  recompute();
  // Bind ResizeObserver once pagesContainer is non-null.
  if (props.pagesContainer) {
    resizeObserver = new ResizeObserver(() => recompute());
    resizeObserver.observe(props.pagesContainer);
    bindScrollListener();
  }
});

watch(
  () => props.pagesContainer,
  (el, _old) => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (el) {
      resizeObserver = new ResizeObserver(() => recompute());
      resizeObserver.observe(el);
      bindScrollListener();
    }
  }
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  if (scrollParent) scrollParent.removeEventListener('scroll', recompute);
});
</script>

<style scoped>
.unified-sidebar {
  /* width / left / position set inline via asideStyle so they can
     react to pageWidthPx changes (zoom, page-setup edits). React's
     UnifiedSidebar fades in via opacity (no slide), so match that
     here — the slide-from-right animation was a Vue-only addition. */
  background: transparent;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  pointer-events: auto;
  z-index: 5;
  transition: opacity 0.15s ease;
}
.unified-sidebar__inner {
  position: relative;
  padding: 0 8px;
}
.unified-sidebar__addcomment {
  position: relative;
  margin-bottom: 8px;
}
</style>
