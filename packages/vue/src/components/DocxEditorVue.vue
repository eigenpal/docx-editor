<template>
  <div class="docx-editor-vue">
    <BasicToolbar
      v-if="showToolbar"
      :view="editorView"
      :get-commands="getCommands"
      :state-tick="stateTick"
      :cursor-marks="cursorMarks"
      :zoom-percent="zoomPercent"
      :is-min-zoom="isMinZoom"
      :is-max-zoom="isMaxZoom"
      :zoom-presets="ZOOM_PRESETS"
      @find-replace="showFindReplace = true"
      @insert-table="showInsertTable = true"
      @insert-image="showInsertImage = true"
      @insert-link="showHyperlink = true"
      @insert-symbol="showInsertSymbol = true"
      @insert-page-break="handleInsertPageBreak"
      @apply-style="handleApplyStyle"
      @insert-toc="execSimpleCommand('generateTOC')"
      @page-setup="showPageSetup = true"
      @toggle-outline="handleToggleOutline"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @zoom-set="setZoom"
      @toggle-sidebar="handleToggleSidebar"
    />

    <TableToolbar
      v-if="showToolbar"
      :view="editorView"
      :get-commands="getCommands"
      :state-tick="stateTick"
    />

    <FindReplaceDialog
      :is-open="showFindReplace"
      :view="editorView"
      @close="showFindReplace = false"
    />

    <InsertTableDialog
      :is-open="showInsertTable"
      @close="showInsertTable = false"
      @insert="handleInsertTable"
    />

    <InsertImageDialog
      :is-open="showInsertImage"
      @close="showInsertImage = false"
      @insert="handleInsertImage"
    />

    <HyperlinkDialog
      :is-open="showHyperlink"
      :view="editorView"
      @close="showHyperlink = false"
      @submit="handleHyperlinkSubmit"
      @remove="handleHyperlinkRemove"
    />

    <InsertSymbolDialog
      :is-open="showInsertSymbol"
      @close="showInsertSymbol = false"
      @insert="handleInsertSymbol"
    />

    <div v-if="parseError" class="docx-editor-vue__error">
      {{ parseError }}
    </div>

    <div v-if="!isReady && !parseError" class="docx-editor-vue__loading">
      Loading...
    </div>

    <!-- Hidden ProseMirror (off-screen, receives keyboard input) -->
    <div ref="hiddenPmRef" class="docx-editor-vue__hidden-pm" />

    <!-- Visible pages (rendered by layout-painter) -->
    <div
      ref="pagesRef"
      class="docx-editor-vue__pages"
      :style="{ transform: `scale(${zoom})`, transformOrigin: 'top center' }"
      @mousedown="handlePagesMouseDown"
      @contextmenu.prevent="handleContextMenu"
      @wheel="handleZoomWheel"
    >
      <ImageEditOverlay
        :image-info="selectedImage"
        :container="pagesRef"
        :view="editorView"
        @open-properties="showImageProperties = true"
        @deselect="selectedImage = null"
      />
    </div>

    <ImagePropertiesDialog
      :is-open="showImageProperties"
      :view="editorView"
      :pm-pos="selectedImage?.pmPos ?? null"
      @close="showImageProperties = false"
    />

    <PageSetupDialog
      :is-open="showPageSetup"
      :section-properties="currentSectionProperties"
      @close="showPageSetup = false"
      @apply="handlePageSetupApply"
    />

    <DocumentOutline
      :is-open="showOutline"
      :headings="outlineHeadings"
      @close="showOutline = false"
      @navigate="handleOutlineNavigate"
    />

    <KeyboardShortcutsDialog
      :is-open="showKeyboardShortcuts"
      @close="showKeyboardShortcuts = false"
    />

    <TextContextMenu
      :is-open="contextMenu.isOpen"
      :position="contextMenu.position"
      :has-selection="contextMenu.hasSelection"
      :is-editable="!readOnly"
      :in-table="contextMenu.inTable"
      @action="handleContextMenuAction"
      @close="contextMenu.isOpen = false"
    />

    <UnifiedSidebar
      :is-open="showSidebar"
      :comments="comments"
      :tracked-changes="trackedChanges"
      :is-adding-comment="isAddingComment"
      :show-resolved="true"
      @close="showSidebar = false"
      @add-comment="handleAddComment"
      @cancel-add-comment="isAddingComment = false"
      @comment-reply="handleCommentReply"
      @comment-resolve="handleCommentResolve"
      @comment-unresolve="handleCommentUnresolve"
      @comment-delete="handleCommentDelete"
      @accept-change="handleAcceptChange"
      @reject-change="handleRejectChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import BasicToolbar from './BasicToolbar.vue';
import FindReplaceDialog from './FindReplaceDialog.vue';
import TableToolbar from './TableToolbar.vue';
import InsertTableDialog from './InsertTableDialog.vue';
import InsertImageDialog from './InsertImageDialog.vue';
import HyperlinkDialog from './HyperlinkDialog.vue';
import InsertSymbolDialog from './InsertSymbolDialog.vue';
import ImageEditOverlay from './ImageEditOverlay.vue';
import type { ImageSelectionInfo } from './ImageEditOverlay.vue';
import ImagePropertiesDialog from './ImagePropertiesDialog.vue';
import PageSetupDialog from './PageSetupDialog.vue';
import DocumentOutline from './DocumentOutline.vue';
import KeyboardShortcutsDialog from './KeyboardShortcutsDialog.vue';
import TextContextMenu from './TextContextMenu.vue';
import UnifiedSidebar from './sidebar/UnifiedSidebar.vue';
import type { TrackedChangeEntry } from './sidebar/sidebarUtils';
import { useDocxEditor } from '../composables/useDocxEditor';
import { useZoom } from '../composables/useZoom';
import { TextSelection } from 'prosemirror-state';
import type { Document, SectionProperties } from '@eigenpal/docx-core/types/document';
import type { Comment } from '@eigenpal/docx-core/types/content';
import { collectHeadings } from '@eigenpal/docx-core/utils/headingCollector';
import type { HeadingInfo } from '@eigenpal/docx-core/utils/headingCollector';
import { clickToPositionDom } from '@eigenpal/docx-core/layout-bridge/clickToPositionDom';
import {
  getSelectionRectsFromDom,
  getCaretPositionFromDom,
} from '@eigenpal/docx-core/layout-bridge/clickToPositionDom';
import { findWordBoundaries } from '@eigenpal/docx-core/utils/textSelection';
import { insertPageBreak } from '@eigenpal/docx-core/prosemirror/commands/pageBreak';
import { applyStyle } from '@eigenpal/docx-core/prosemirror/commands/paragraph';
import { createStyleResolver } from '@eigenpal/docx-core/prosemirror/styles';

const props = withDefaults(
  defineProps<{
    documentBuffer?: ArrayBuffer | null;
    document?: Document | null;
    showToolbar?: boolean;
    readOnly?: boolean;
  }>(),
  {
    documentBuffer: null,
    document: null,
    showToolbar: true,
    readOnly: false,
  }
);

const emit = defineEmits<{
  (e: 'change', doc: Document): void;
  (e: 'error', error: Error): void;
  (e: 'ready'): void;
}>();

const hiddenPmRef = ref<HTMLElement | null>(null);
const pagesRef = ref<HTMLElement | null>(null);
const stateTick = ref(0);
const showFindReplace = ref(false);
const showInsertTable = ref(false);
const showInsertImage = ref(false);
const showHyperlink = ref(false);
const showInsertSymbol = ref(false);
const showImageProperties = ref(false);
const showPageSetup = ref(false);
const showOutline = ref(false);
const showKeyboardShortcuts = ref(false);
const showSidebar = ref(false);
const isAddingComment = ref(false);
const comments = ref<Comment[]>([]);
const trackedChanges = ref<TrackedChangeEntry[]>([]);
const contextMenu = ref({
  isOpen: false,
  position: { x: 0, y: 0 },
  hasSelection: false,
  inTable: false,
});
const outlineHeadings = ref<HeadingInfo[]>([]);
const selectedImage = ref<ImageSelectionInfo | null>(null);

const {
  zoom,
  zoomPercent,
  isMinZoom,
  isMaxZoom,
  setZoom,
  zoomIn,
  zoomOut,
  handleWheel: handleZoomWheel,
  handleKeyDown: handleZoomKeyDown,
  ZOOM_PRESETS,
} = useZoom();

const {
  editorView,
  isReady,
  parseError,
  cursorMarks,
  loadBuffer,
  loadDocument,
  save,
  focus,
  destroy,
  getDocument,
  getCommands,
  reLayout,
} = useDocxEditor({
  hiddenContainer: hiddenPmRef,
  pagesContainer: pagesRef,
  readOnly: props.readOnly,
  onChange: (doc) => emit('change', doc),
  onError: (err) => emit('error', err),
  onSelectionUpdate: () => {
    stateTick.value++;
    updateSelectionOverlay();
  },
});

watch(
  () => props.documentBuffer,
  async (buf) => {
    if (buf) {
      await loadBuffer(buf);
      nextTick(() => extractCommentsAndChanges());
      emit('ready');
    }
  }
);

watch(
  () => props.document,
  (doc) => {
    if (doc) {
      loadDocument(doc);
      nextTick(() => extractCommentsAndChanges());
      emit('ready');
    }
  }
);

onMounted(async () => {
  await nextTick();
  if (props.documentBuffer) {
    await loadBuffer(props.documentBuffer);
    nextTick(() => extractCommentsAndChanges());
    emit('ready');
  } else if (props.document) {
    loadDocument(props.document);
    emit('ready');
  }
});

// =========================================================================
// Selection & caret overlay
// =========================================================================

let caretBlinkInterval: ReturnType<typeof setInterval> | null = null;
let caretEl: HTMLElement | null = null;

function clearOverlay() {
  const container = pagesRef.value;
  if (!container) return;
  container.querySelectorAll('.vue-sel-rect, .vue-caret').forEach((el) => el.remove());
  if (caretBlinkInterval !== null) {
    clearInterval(caretBlinkInterval);
    caretBlinkInterval = null;
  }
  caretEl = null;
}

function updateSelectionOverlay() {
  const container = pagesRef.value;
  const view = editorView.value;
  if (!container || !view) return;

  clearOverlay();

  const { from, to, empty } = view.state.selection;

  // Account for scroll offset: overlays are position:absolute inside the
  // scrollable container, so we need to add scrollTop/scrollLeft to convert
  // viewport-relative coordinates from getBoundingClientRect to container-relative.
  const scrollTop = container.scrollTop;
  const scrollLeft = container.scrollLeft;

  if (empty) {
    // Draw blinking caret
    const overlayRect = container.getBoundingClientRect();
    const caret = getCaretPositionFromDom(container, from, overlayRect);
    if (caret) {
      const el = document.createElement('div');
      el.className = 'vue-caret';
      el.style.cssText = `
        position: absolute;
        left: ${caret.x + scrollLeft}px;
        top: ${caret.y + scrollTop}px;
        width: 1.5px;
        height: ${caret.height}px;
        background: #000;
        pointer-events: none;
        z-index: 2;
      `;
      container.appendChild(el);
      caretEl = el;

      // Blink
      let visible = true;
      caretBlinkInterval = setInterval(() => {
        visible = !visible;
        if (caretEl) caretEl.style.opacity = visible ? '1' : '0';
      }, 530);
    }
    return;
  }

  // Draw selection highlight rects (character-level)
  const overlayRect = container.getBoundingClientRect();
  const rects = getSelectionRectsFromDom(container, from, to, overlayRect);

  for (const rect of rects) {
    const el = document.createElement('div');
    el.className = 'vue-sel-rect';
    el.style.cssText = `
      position: absolute;
      left: ${rect.x + scrollLeft}px;
      top: ${rect.y + scrollTop}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: rgba(66, 133, 244, 0.3);
      pointer-events: none;
      z-index: 1;
    `;
    container.appendChild(el);
  }
}

// =========================================================================
// Multi-click detection (double-click = word, triple-click = paragraph)
// =========================================================================

const MULTI_CLICK_DELAY = 500;
let lastClickTime = 0;
let lastClickPos: number | null = null;
let clickCount = 0;

function findElementAtPosition(container: HTMLElement, pmPos: number): HTMLElement | null {
  // dataset.pmStart in JS maps to data-pm-start in HTML
  const els = container.querySelectorAll<HTMLElement>('[data-pm-start]');
  for (const el of els) {
    const start = Number(el.dataset.pmStart);
    const end = Number(el.dataset.pmEnd);
    if (!isNaN(start) && !isNaN(end) && pmPos >= start && pmPos <= end) {
      return el;
    }
  }
  return null;
}

function selectWord(pos: number) {
  const container = pagesRef.value;
  if (!container) return;
  const el = findElementAtPosition(container, pos);
  if (!el) return;
  const text = el.textContent || '';
  const pmStart = Number(el.dataset.pmStart) || 0;
  const offset = pos - pmStart;
  const [start, end] = findWordBoundaries(text, offset);
  const from = pmStart + start;
  const to = pmStart + end;
  if (from < to) {
    setPmSelection(from, to);
  }
}

function selectParagraph(pos: number) {
  const container = pagesRef.value;
  if (!container) return;
  const el = findElementAtPosition(container, pos);
  if (!el) return;
  const paragraph = el.closest('.layout-paragraph') as HTMLElement | null;
  if (!paragraph) return;
  const pmStart = Number(paragraph.dataset.pmStart);
  const pmEnd = Number(paragraph.dataset.pmEnd);
  if (!isNaN(pmStart) && !isNaN(pmEnd) && pmStart < pmEnd) {
    setPmSelection(pmStart, pmEnd);
  }
}

// =========================================================================
// Drag-to-select support
// =========================================================================

let isDragging = false;
let dragAnchor: number | null = null;

function resolvePos(clientX: number, clientY: number): number | null {
  const container = pagesRef.value;
  if (!container) return null;
  const pos = clickToPositionDom(container, clientX, clientY, 1);
  if (pos === null || pos < 0) return null;
  const view = editorView.value;
  if (!view) return null;
  return Math.min(pos, view.state.doc.content.size);
}

function setPmSelection(anchor: number, head?: number) {
  const view = editorView.value;
  if (!view) return;
  const $anchor = view.state.doc.resolve(anchor);
  const $head = head !== undefined ? view.state.doc.resolve(head) : $anchor;
  const sel = TextSelection.between($anchor, $head);
  view.dispatch(view.state.tr.setSelection(sel));
}

function handlePagesMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;
  const view = editorView.value;
  if (!view) return;

  // Check if user clicked on an image
  const target = event.target as HTMLElement;
  const imgEl = target.closest('.docx-image') as HTMLElement | null;
  if (imgEl) {
    event.preventDefault();
    event.stopPropagation();
    const pmStart = Number(imgEl.dataset.pmStart);
    if (!isNaN(pmStart)) {
      selectedImage.value = {
        element: imgEl,
        pmPos: pmStart,
        width: imgEl.offsetWidth,
        height: imgEl.offsetHeight,
      };
    }
    view.focus();
    return;
  }

  // Clicked outside image — deselect
  selectedImage.value = null;

  // Prevent browser from moving focus to the pages div — PM must keep focus
  event.preventDefault();

  const pos = resolvePos(event.clientX, event.clientY);
  if (pos === null) {
    view.focus();
    return;
  }

  // Multi-click detection
  const now = Date.now();
  if (now - lastClickTime < MULTI_CLICK_DELAY && lastClickPos === pos) {
    clickCount++;
  } else {
    clickCount = 1;
  }
  lastClickTime = now;
  lastClickPos = pos;

  if (clickCount === 2) {
    selectWord(pos);
  } else if (clickCount >= 3) {
    selectParagraph(pos);
    clickCount = 0;
  } else {
    // Single click
    if (event.shiftKey) {
      const { from } = view.state.selection;
      setPmSelection(from, pos);
    } else {
      setPmSelection(pos);
    }
    dragAnchor = pos;
    isDragging = true;
  }

  view.focus();
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging || dragAnchor === null) return;
  const pos = resolvePos(event.clientX, event.clientY);
  if (pos !== null && pos !== dragAnchor) {
    setPmSelection(dragAnchor, pos);
  }
}

function handleMouseUp() {
  isDragging = false;
}

// =========================================================================
// Insert operation handlers
// =========================================================================

function execSimpleCommand(name: string) {
  const view = editorView.value;
  if (!view) return;
  const cmds = getCommands();
  const cmdFactory = cmds[name];
  if (!cmdFactory) return;
  const command = cmdFactory();
  command(view.state, (tr: any) => view.dispatch(tr), view);
  view.focus();
}

function handleInsertTable(rows: number, cols: number) {
  const view = editorView.value;
  if (!view) return;
  const cmds = getCommands();
  const cmd = cmds['insertTable'];
  if (!cmd) return;
  const command = cmd(rows, cols);
  command(view.state, (tr: any) => view.dispatch(tr), view);
  view.focus();
}

function handleInsertImage(data: { src: string; width: number; height: number; alt: string }) {
  const view = editorView.value;
  if (!view) return;
  const imageNodeType = view.state.schema.nodes.image;
  if (!imageNodeType) return;
  const node = imageNodeType.create({
    src: data.src,
    alt: data.alt,
    width: data.width,
    height: data.height,
  });
  const { from } = view.state.selection;
  const tr = view.state.tr.insert(from, node);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function handleHyperlinkSubmit(data: { url: string; displayText: string; tooltip: string }) {
  const view = editorView.value;
  if (!view) return;
  const cmds = getCommands();
  const { empty } = view.state.selection;

  if (empty && data.displayText) {
    // Insert new link with text
    const cmd = cmds['insertHyperlink'];
    if (cmd) {
      const command = cmd(data.displayText, data.url, data.tooltip || undefined);
      command(view.state, (tr: any) => view.dispatch(tr), view);
    }
  } else {
    // Apply link to selection
    const cmd = cmds['setHyperlink'];
    if (cmd) {
      const command = cmd(data.url, data.tooltip || undefined);
      command(view.state, (tr: any) => view.dispatch(tr), view);
    }
  }
  view.focus();
}

function handleHyperlinkRemove() {
  const view = editorView.value;
  if (!view) return;
  const cmds = getCommands();
  const cmd = cmds['removeHyperlink'];
  if (cmd) {
    const command = cmd();
    command(view.state, (tr: any) => view.dispatch(tr), view);
  }
  view.focus();
}

function handleApplyStyle(styleId: string) {
  const view = editorView.value;
  if (!view) return;
  const doc = getDocument();
  const styles = doc?.package?.styles;
  if (styles) {
    const resolver = createStyleResolver(styles);
    const resolved = resolver.resolveParagraphStyle(styleId);
    applyStyle(styleId, {
      paragraphFormatting: resolved.paragraphFormatting,
      runFormatting: resolved.runFormatting,
    })(view.state, (tr: any) => view.dispatch(tr));
  } else {
    applyStyle(styleId)(view.state, (tr: any) => view.dispatch(tr));
  }
  view.focus();
}

function handleInsertPageBreak() {
  const view = editorView.value;
  if (!view) return;
  insertPageBreak(view.state, (tr: any) => view.dispatch(tr), view);
  view.focus();
}

function handleInsertSymbol(symbol: string) {
  const view = editorView.value;
  if (!view) return;
  const { from } = view.state.selection;
  const tr = view.state.tr.insertText(symbol, from);
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

// =========================================================================
// Page setup
// =========================================================================

const currentSectionProperties = computed(() => {
  const doc = getDocument();
  return doc?.package?.document?.finalSectionProperties ?? null;
});

function handlePageSetupApply(sp: Partial<SectionProperties>) {
  const doc = getDocument();
  if (!doc?.package?.document) return;
  const existing = doc.package.document.finalSectionProperties ?? {};
  doc.package.document.finalSectionProperties = { ...existing, ...sp };
  // Re-render with new page dimensions (empty tr won't trigger docChanged)
  reLayout();
  emit('change', doc);
}

// =========================================================================
// Document outline
// =========================================================================

function handleToggleOutline() {
  if (!showOutline.value) {
    // Opening: collect headings
    const view = editorView.value;
    if (view) {
      outlineHeadings.value = collectHeadings(view.state.doc);
    }
  }
  showOutline.value = !showOutline.value;
}

function handleOutlineNavigate(pmPos: number) {
  const view = editorView.value;
  if (!view) return;
  // Set selection to heading position and scroll into view
  const $pos = view.state.doc.resolve(Math.min(pmPos + 1, view.state.doc.content.size));
  const sel = TextSelection.near($pos);
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
  view.focus();
}

function handleToggleSidebar() {
  if (!showSidebar.value) {
    extractCommentsAndChanges();
  }
  showSidebar.value = !showSidebar.value;
}

// =========================================================================
// Context menu
// =========================================================================

function handleContextMenu(event: MouseEvent) {
  const view = editorView.value;
  if (!view) return;
  const { empty } = view.state.selection;
  const target = event.target as HTMLElement;
  const inTable = !!target.closest('.layout-table, table');

  contextMenu.value = {
    isOpen: true,
    position: { x: event.clientX, y: event.clientY },
    hasSelection: !empty,
    inTable,
  };
}

function handleContextMenuAction(action: string) {
  const view = editorView.value;
  if (!view) return;
  const cmds = getCommands();

  switch (action) {
    case 'cut':
      document.execCommand('cut');
      break;
    case 'copy':
      document.execCommand('copy');
      break;
    case 'paste':
      navigator.clipboard?.readText().then(text => {
        if (text) {
          const { from } = view.state.selection;
          view.dispatch(view.state.tr.insertText(text, from));
        }
      });
      break;
    case 'delete': {
      const { from, to } = view.state.selection;
      if (from !== to) view.dispatch(view.state.tr.delete(from, to));
      break;
    }
    case 'selectAll': {
      const sel = TextSelection.create(view.state.doc, 0, view.state.doc.content.size);
      view.dispatch(view.state.tr.setSelection(sel));
      break;
    }
    case 'addRowAbove':
    case 'addRowBelow':
    case 'deleteRow':
    case 'addColumnLeft':
    case 'addColumnRight':
    case 'deleteColumn': {
      const cmd = cmds[action];
      if (cmd) {
        const command = cmd();
        command(view.state, (tr: any) => view.dispatch(tr), view);
      }
      break;
    }
  }
  view.focus();
}

// =========================================================================
// Comments & tracked changes sidebar
// =========================================================================

function extractCommentsAndChanges() {
  const doc = getDocument();
  const view = editorView.value;
  if (!doc || !view) return;

  // Extract comments from document model
  comments.value = doc.package?.comments ?? [];

  // Extract tracked changes from ProseMirror marks
  const { doc: pmDoc, schema } = view.state;
  const insertionType = schema.marks.insertion;
  const deletionType = schema.marks.deletion;
  if (!insertionType && !deletionType) {
    trackedChanges.value = [];
    return;
  }

  const entries: TrackedChangeEntry[] = [];

  pmDoc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type === insertionType) {
        entries.push({
          type: 'insertion',
          text: node.text || '',
          author: mark.attrs.author || 'Unknown',
          date: mark.attrs.date,
          from: pos,
          to: pos + node.nodeSize,
          revisionId: mark.attrs.revisionId || 0,
        });
      } else if (mark.type === deletionType) {
        entries.push({
          type: 'deletion',
          text: node.text || '',
          author: mark.attrs.author || 'Unknown',
          date: mark.attrs.date,
          from: pos,
          to: pos + node.nodeSize,
          revisionId: mark.attrs.revisionId || 0,
        });
      }
    }
  });

  // Merge adjacent entries with same revisionId
  const merged: TrackedChangeEntry[] = [];
  for (const entry of entries) {
    const last = merged[merged.length - 1];
    if (last && last.revisionId === entry.revisionId && last.type === entry.type && last.to === entry.from) {
      last.text += entry.text;
      last.to = entry.to;
    } else {
      merged.push({ ...entry });
    }
  }

  // Detect replacements (adjacent deletion + insertion, same author)
  const final: TrackedChangeEntry[] = [];
  for (let i = 0; i < merged.length; i++) {
    const curr = merged[i];
    const next = merged[i + 1];
    if (curr.type === 'deletion' && next?.type === 'insertion' && curr.author === next.author && curr.to === next.from) {
      final.push({
        type: 'replacement',
        text: next.text,
        deletedText: curr.text,
        author: curr.author,
        date: curr.date,
        from: curr.from,
        to: next.to,
        revisionId: curr.revisionId,
        insertionRevisionId: next.revisionId,
      });
      i++; // skip next
    } else {
      final.push(curr);
    }
  }

  trackedChanges.value = final;
}

function handleAddComment(text: string) {
  // For now, add comment to document model
  const doc = getDocument();
  if (!doc?.package) return;
  if (!doc.package.comments) doc.package.comments = [];

  const maxId = doc.package.comments.reduce((max, c) => Math.max(max, c.id), 0);
  const newComment: Comment = {
    id: maxId + 1,
    author: 'User',
    date: new Date().toISOString(),
    content: [{ type: 'paragraph', properties: {}, content: [{ type: 'run', properties: {}, content: [{ type: 'text', text }] }] }] as any,
  };
  doc.package.comments.push(newComment);
  comments.value = [...doc.package.comments];
  isAddingComment.value = false;
  emit('change', doc);
}

function handleCommentReply(commentId: number, text: string) {
  const doc = getDocument();
  if (!doc?.package?.comments) return;

  const maxId = doc.package.comments.reduce((max, c) => Math.max(max, c.id), 0);
  const reply: Comment = {
    id: maxId + 1,
    author: 'User',
    date: new Date().toISOString(),
    content: [{ type: 'paragraph', properties: {}, content: [{ type: 'run', properties: {}, content: [{ type: 'text', text }] }] }] as any,
    parentId: commentId,
  };
  doc.package.comments.push(reply);
  comments.value = [...doc.package.comments];
  emit('change', doc);
}

function handleCommentResolve(commentId: number) {
  const doc = getDocument();
  if (!doc?.package?.comments) return;
  const c = doc.package.comments.find(c => c.id === commentId);
  if (c) c.done = true;
  comments.value = [...doc.package.comments];
  emit('change', doc);
}

function handleCommentUnresolve(commentId: number) {
  const doc = getDocument();
  if (!doc?.package?.comments) return;
  const c = doc.package.comments.find(c => c.id === commentId);
  if (c) c.done = false;
  comments.value = [...doc.package.comments];
  emit('change', doc);
}

function handleCommentDelete(commentId: number) {
  const doc = getDocument();
  if (!doc?.package?.comments) return;
  // Remove comment and its replies
  doc.package.comments = doc.package.comments.filter(c => c.id !== commentId && c.parentId !== commentId);
  comments.value = [...doc.package.comments];
  emit('change', doc);
}

function handleAcceptChange(from: number, to: number) {
  const view = editorView.value;
  if (!view) return;
  const { schema } = view.state;
  let tr = view.state.tr;

  // Accept: remove deletion marks (delete the deleted text), keep insertion text (remove mark)
  const deletionType = schema.marks.deletion;
  const insertionType = schema.marks.insertion;

  if (deletionType) tr = tr.removeMark(from, to, deletionType);
  if (insertionType) tr = tr.removeMark(from, to, insertionType);

  view.dispatch(tr);
  extractCommentsAndChanges();
  view.focus();
}

function handleRejectChange(from: number, to: number) {
  const view = editorView.value;
  if (!view) return;
  const { schema } = view.state;
  let tr = view.state.tr;

  const deletionType = schema.marks.deletion;
  const insertionType = schema.marks.insertion;

  if (deletionType) tr = tr.removeMark(from, to, deletionType);
  if (insertionType) tr = tr.removeMark(from, to, insertionType);

  view.dispatch(tr);
  extractCommentsAndChanges();
  view.focus();
}

// =========================================================================
// Keyboard shortcuts
// =========================================================================

function handleKeyDown(e: KeyboardEvent) {
  // F1 opens keyboard shortcuts
  if (e.key === 'F1') {
    e.preventDefault();
    showKeyboardShortcuts.value = true;
    return;
  }

  // Zoom shortcuts (Ctrl+=/Ctrl+-/Ctrl+0)
  handleZoomKeyDown(e);

  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 'f' || e.key === 'h') {
    e.preventDefault();
    showFindReplace.value = true;
  } else if (e.key === 'k') {
    e.preventDefault();
    showHyperlink.value = true;
  } else if (e.key === '/') {
    e.preventDefault();
    showKeyboardShortcuts.value = !showKeyboardShortcuts.value;
  }
}

onMounted(() => {
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
  window.removeEventListener('keydown', handleKeyDown);
  clearOverlay();
});

defineExpose({ save, focus, destroy, getDocument });
</script>

<style>
.docx-editor-vue {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.docx-editor-vue__hidden-pm {
  position: fixed;
  left: -9999px;
  top: 0;
  opacity: 0;
  z-index: -1;
  pointer-events: none;
  user-select: none;
  overflow-anchor: none;
}
.docx-editor-vue__pages {
  flex: 1;
  overflow-y: auto;
  background: var(--doc-bg, #f8f9fa);
  cursor: text;
  position: relative;
}
.docx-editor-vue__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: #64748b;
  font-size: 14px;
}
.docx-editor-vue__error {
  padding: 1rem;
  background: #fef2f2;
  color: #dc2626;
  font-size: 13px;
  border-bottom: 1px solid #fecaca;
}
</style>
