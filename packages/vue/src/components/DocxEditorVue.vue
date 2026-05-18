<template>
  <div
    :class="[
      'docx-editor-vue ep-root paged-editor',
      className,
      {
        'paged-editor--readonly': readOnly,
        'paged-editor--hf-editing': hfEdit !== null,
        'paged-editor--editing-header': hfEdit?.position === 'header',
        'paged-editor--editing-footer': hfEdit?.position === 'footer',
      },
    ]"
    :style="style"
  >
    <!-- Toolbar shell — wraps title-bar + Toolbar so a single
         `bg-white shadow-sm` rule applies under both. Mirrors React's
         `<EditorToolbar>` (EditorToolbar.tsx:50:
         `flex flex-col bg-white shadow-sm flex-shrink-0`). -->
    <div class="docx-editor-vue__toolbar-shell">
      <DocxEditorMenuBar
        :show-menu-bar="showMenuBar"
        :document-name="documentName"
        :document-name-editable="documentNameEditable"
        :render-logo="renderLogo"
        :render-title-bar-right="renderTitleBarRight"
        @rename="handleDocumentNameChange"
        @menu-action="handleMenuAction"
        @insert-table="handleMenuTableInsert"
      >
        <template #title-bar-left><slot name="title-bar-left" /></template>
        <template #title-bar-right><slot name="title-bar-right" /></template>
      </DocxEditorMenuBar>

      <!-- Toolbar: pill with formatting buttons + editing-mode dropdown
           on the right end. Mirrors React's <Toolbar> inline layout.
           TableToolbar is rendered into Toolbar's `table-context`
           slot so the table-context buttons appear inline inside the same
           pill (React Toolbar.tsx does this with a conditional
           `<ToolbarGroup>`). When the cursor leaves a table the slot
           renders nothing and the pill collapses back to formatting
           buttons + editing mode only. -->
      <Toolbar
        v-if="showToolbar"
        :view="editorView"
        :get-commands="getCommands"
        :state-tick="stateTick"
        :zoom-percent="zoomPercent"
        :is-min-zoom="isMinZoom"
        :is-max-zoom="isMaxZoom"
        :zoom-presets="ZOOM_PRESETS"
        :show-zoom-control="showZoomControl"
        :editor-mode="editorMode"
        :comments-sidebar-open="showSidebar"
        :image-context="imageToolbarContext"
        :theme="documentTheme"
        :font-families="fontFamilies"
        @insert-link="showHyperlink = true"
        @apply-style="handleApplyStyle"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @zoom-set="setZoom"
        @toggle-sidebar="handleToggleSidebar"
        @mode-change="setEditorMode"
        @image-wrap-type="handleToolbarImageWrap"
        @image-properties="showImageProperties = true"
        @image-transform="handleImageTransform"
      >
        <template #table-context>
          <TableToolbar
            :view="editorView"
            :get-commands="getCommands"
            :state-tick="stateTick"
            :theme="documentTheme"
          />
        </template>
        <template v-if="toolbarExtra" #toolbar-extra>
          <component :is="toolbarExtra" />
        </template>
        <template v-else #toolbar-extra>
          <slot name="toolbar-extra" />
        </template>
      </Toolbar>
    </div>

    <DocxEditorDialogs
      v-model:show-find-replace="showFindReplace"
      v-model:show-insert-image="showInsertImage"
      v-model:show-hyperlink="showHyperlink"
      v-model:show-insert-symbol="showInsertSymbol"
      v-model:show-image-properties="showImageProperties"
      v-model:show-page-setup="showPageSetup"
      v-model:show-keyboard-shortcuts="showKeyboardShortcuts"
      :view="editorView"
      :bookmarks="bookmarkOptions"
      :selected-image-pm-pos="selectedImage?.pmPos ?? null"
      :section-properties="currentSectionProps"
      @insert-image="handleInsertImage"
      @insert-symbol="handleInsertSymbol"
      @hyperlink-submit="handleHyperlinkSubmit"
      @hyperlink-remove="handleHyperlinkRemove"
      @page-setup-apply="handlePageSetupApply"
    />

    <div v-if="parseError" class="docx-editor-vue__error">
      {{ parseError }}
    </div>

    <div v-if="!isReady && !parseError" class="docx-editor-vue__loading">Loading...</div>

    <!-- Hidden ProseMirror (off-screen, receives keyboard input). Class
         matches React's PagedEditor so shared CSS attaches. -->
    <div ref="hiddenPmRef" class="docx-editor-vue__hidden-pm paged-editor__hidden-pm" />

    <!-- Editor scroll container: doc-bg wraps both the ruler row
         (centered + sticky) and the page area below. -->
    <div class="docx-editor-vue__editor-scroll" @mousedown="handleEditorScrollMouseDown">
      <div
        v-if="showRuler && currentSectionProps"
        class="docx-editor-vue__ruler-row"
        :style="rulerRowStyle"
      >
        <HorizontalRuler
          :section-props="currentSectionProps"
          :zoom="zoom"
          :editable="!readOnly"
          @left-margin-change="handleLeftMarginChange"
          @right-margin-change="handleRightMarginChange"
          @indent-left-change="handleIndentLeftChange"
          @indent-right-change="handleIndentRightChange"
          @first-line-indent-change="handleFirstLineIndentChange"
          @tab-stop-remove="handleTabMarkRemove"
        />
      </div>

      <div class="docx-editor-vue__editor-area">
        <div
          ref="pagesViewportRef"
          class="docx-editor-vue__pages-viewport"
          @mousedown="handlePagesMouseDown"
          @mousemove="handlePagesMouseMove"
          @click="handlePagesClick"
          @dblclick="handlePagesDoubleClick"
          @contextmenu.prevent="handleContextMenu"
          @wheel="handleZoomWheel"
        >
          <div v-if="showRuler && currentSectionProps" class="docx-editor-vue__vertical-ruler">
            <VerticalRuler
              :section-props="currentSectionProps"
              :zoom="zoom"
              :editable="!readOnly"
              @top-margin-change="handleTopMarginChange"
              @bottom-margin-change="handleBottomMarginChange"
            />
          </div>
          <div
            ref="pagesRef"
            class="docx-editor-vue__pages paged-editor__pages"
            :style="pagesContainerStyle"
          />

          <InlineHeaderFooterEditor
            :is-open="hfEdit !== null"
            :position="hfEdit?.position ?? 'header'"
            :header-footer="hfEdit?.headerFooter ?? null"
            :styles="getDocument()?.package?.styles ?? null"
            :theme="getDocument()?.package?.theme ?? null"
            :target-rect="hfEdit?.targetRect ?? null"
            @save="handleHfSave"
            @close="hfEdit = null"
            @remove="handleHfRemove"
          />

          <ImageSelectionOverlay
            :image-info="selectedImage"
            :zoom="zoom"
            :view="editorView"
            @open-properties="showImageProperties = true"
            @deselect="selectedImage = null"
            @interact-start="imageInteracting = true"
            @interact-end="imageInteracting = false"
            @context-menu="handleSelectedImageContextMenu"
          />

          <DecorationLayer
            :get-view="getEditorViewForDecorations"
            :get-pages-container="getPagesContainerForDecorations"
            :zoom="zoom"
            :transaction-version="stateTick"
            :sync-coordinator="syncCoordinator"
          />

          <!-- Floating "Add comment" button — appears at the right edge
             of the page when the user has a non-empty selection. -->
          <button
            v-if="floatingCommentBtn && !isAddingComment && !readOnly"
            type="button"
            class="docx-editor-vue__floating-comment"
            :style="{ top: floatingCommentBtn.top + 'px', left: floatingCommentBtn.left + 'px' }"
            :title="t('comments.addComment')"
            @mousedown.prevent.stop="handleStartAddComment"
          >
            <MaterialSymbol name="add_comment" :size="16" />
          </button>

          <!-- Table quick-action "+" button — appears on hover near a
             table edge. Hovering the button cancels the hide-debounce
             so the user can actually reach it. -->
          <button
            v-if="tableInsertButton && !readOnly"
            type="button"
            class="docx-editor-vue__table-insert-btn"
            :style="{
              left: tableInsertButton.x + 'px',
              top: tableInsertButton.y + 'px',
            }"
            :title="
              tableInsertButton.type === 'row' ? 'Insert row below' : 'Insert column to the right'
            "
            :aria-label="
              tableInsertButton.type === 'row' ? 'Insert row below' : 'Insert column to the right'
            "
            @mousedown="handleTableInsertClick"
            @mouseenter="clearTableInsertTimer"
            @mouseleave="tableInsertButton = null"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 1v10M1 6h10"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>

          <CommentMarginMarkers
            :comments="comments"
            :pages-container="pagesRef"
            :zoom="zoom"
            :page-width-px="pageWidthPx"
            :sidebar-open="showSidebar"
            :resolved-comment-ids="resolvedCommentIds"
            @marker-click="handleMarkerClick"
          />

          <UnifiedSidebar
            :is-open="showSidebar"
            :comments="comments"
            :tracked-changes="trackedChanges"
            :is-adding-comment="isAddingComment"
            :add-comment-y-position="addCommentYPosition"
            :show-resolved="true"
            :pages-container="pagesRef"
            :page-width-px="pageWidthPx"
            :zoom="zoom"
            :active-item-id="activeSidebarItem"
            @close="showSidebar = false"
            @add-comment="handleAddComment"
            @cancel-add-comment="handleCancelAddComment"
            @comment-reply="handleCommentReply"
            @comment-resolve="resolveComment"
            @comment-unresolve="handleCommentUnresolve"
            @comment-delete="handleCommentDelete"
            @accept-change="handleAcceptChange"
            @reject-change="handleRejectChange"
            @tracked-change-reply="handleTrackedChangeReply"
            @update:active-item-id="(id: string | null) => (activeSidebarItem = id)"
          />
        </div>

        <button
          v-if="!showOutline && showOutlineButton"
          type="button"
          class="docx-editor-vue__outline-toggle"
          :title="'Show document outline'"
          @click="handleToggleOutline"
          @mousedown.stop
        >
          <MaterialSymbol name="format_list_bulleted" :size="20" />
        </button>

        <PageIndicator
          v-if="scrollPageInfo.totalPages > 1"
          :current-page="scrollPageInfo.currentPage"
          :total-pages="scrollPageInfo.totalPages"
          :visible="scrollPageInfo.visible"
        />

        <DocumentOutline
          :is-open="showOutline"
          :headings="outlineHeadings"
          @close="showOutline = false"
          @navigate="handleOutlineNavigate"
        />
      </div>
    </div>

    <!-- Hidden file picker for File > Open (mirrors React DocxEditor's
         `docxInputRef`). Host slots can still expose their own button
         (e.g. examples/vue/src/App.vue's title-bar-right `Open`). -->
    <input
      ref="docxInputRef"
      type="file"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      style="display: none"
      @change="handleDocxFileChange"
    />

    <DocxEditorOverlays
      :read-only="readOnly"
      :context-menu="contextMenu"
      :image-context-menu="imageContextMenu"
      :image-context-menu-text-actions="imageContextMenuTextActions"
      :can-open-image-properties="!!selectedImage"
      :hyperlink-popup-data="hyperlinkPopupData"
      @context-menu-action="handleContextMenuAction"
      @close-context-menu="contextMenu.isOpen = false"
      @image-wrap-select="handleImageWrapSelect"
      @close-image-context-menu="imageContextMenu = null"
      @open-image-properties="showImageProperties = true"
      @hyperlink-navigate="handleHyperlinkPopupNavigate"
      @hyperlink-edit="handleHyperlinkPopupEdit"
      @hyperlink-remove="handleHyperlinkPopupRemove"
      @close-hyperlink-popup="hyperlinkPopupData = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { getSelectionInfo as getSelectionInfoImpl } from '../utils/refApiQueries';
import Toolbar from './Toolbar.vue';
import TableToolbar from './ui/TableToolbar.vue';
import DecorationLayer from './DecorationLayer.vue';
import ImageSelectionOverlay from './ImageSelectionOverlay.vue';
import DocumentOutline from './DocumentOutline.vue';
import UnifiedSidebar from './UnifiedSidebar.vue';
import CommentMarginMarkers from './CommentMarginMarkers.vue';
import MaterialSymbol from './ui/MaterialSymbol.vue';
import PageIndicator from './PageIndicator.vue';
import InlineHeaderFooterEditor from './InlineHeaderFooterEditor.vue';
import HorizontalRuler from './ui/HorizontalRuler.vue';
import VerticalRuler from './ui/VerticalRuler.vue';
import DocxEditorMenuBar from './DocxEditorMenuBar.vue';
import DocxEditorDialogs from './DocxEditorDialogs.vue';
import DocxEditorOverlays from './DocxEditorOverlays.vue';
import type { HyperlinkPopupData } from './ui/HyperlinkPopup.vue';
import type { TrackedChangeEntry } from './sidebar/sidebarUtils';
import type { EditorMode } from '../editor-mode';
import type { DocxEditorProps } from '../docx-editor-props';
import { useDocxEditor } from '../composables/useDocxEditor';
import { useZoom } from '../composables/useZoom';
import { useTableResize } from '../composables/useTableResize';
import { useFileIO } from '../composables/useFileIO';
import { useHyperlinkManagement } from '../composables/useHyperlinkManagement';
import { useFormattingActions } from '../composables/useFormattingActions';
import { usePageSetupControls } from '../composables/usePageSetupControls';
import { useOutlineSidebar } from '../composables/useOutlineSidebar';
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts';
import { useCommentManagement } from '../composables/useCommentManagement';
import { useCommentLifecycle } from '../composables/useCommentLifecycle';
import { useImageActions } from '../composables/useImageActions';
import { useContextMenus } from '../composables/useContextMenus';
import { usePagesPointer } from '../composables/usePagesPointer';
import { useSelectionSync } from '../composables/useSelectionSync';
import { useMenuActions } from '../composables/useMenuActions';
import { useDocumentLifecycle } from '../composables/useDocumentLifecycle';
import { useDocxEditorRefApi } from '../composables/useDocxEditorRefApi';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { HeadingInfo } from '@eigenpal/docx-editor-core/utils/headingCollector';
import { createTranslator, provideLocale } from '../i18n';
import { twipsToPixels } from '@eigenpal/docx-editor-core/utils/units';
import { SIDEBAR_DOCUMENT_SHIFT } from '@eigenpal/docx-editor-core/utils';
import { SelectionBridge } from '@eigenpal/docx-editor-core/prosemirror';

const props = withDefaults(defineProps<DocxEditorProps>(), {
  documentBuffer: null,
  document: null,
  showToolbar: true,
  showMenuBar: true,
  showRuler: true,
  documentName: '',
  readOnly: false,
  mode: 'editing',
  i18n: undefined,
  theme: null,
  externalPlugins: () => [],
  showZoomControl: true,
  initialZoom: 1,
  toolbarExtra: undefined,
  className: '',
  style: undefined,
  showOutline: false,
  showOutlineButton: true,
  fontFamilies: undefined,
  onPrint: undefined,
  disableFindReplaceShortcuts: false,
  renderLogo: undefined,
  onDocumentNameChange: undefined,
  documentNameEditable: true,
  renderTitleBarRight: undefined,
});

const emit = defineEmits<{
  (e: 'change', doc: Document): void;
  (e: 'update:document', doc: Document | null): void;
  (e: 'error', error: Error): void;
  (e: 'ready'): void;
  (e: 'rename', name: string): void;
  (e: 'menu-action', action: string): void;
  (e: 'mode-change', mode: EditorMode): void;
}>();

const editorMode = ref<EditorMode>(props.mode);
const readOnly = computed(() => props.readOnly || editorMode.value === 'viewing');

provideLocale(computed(() => props.i18n));
const { t } = createTranslator(computed(() => props.i18n));

// Foundational refs — declared up front because so many composables
// thread them through their options. Style/layout-derived computed
// refs sit further down.
const hiddenPmRef = ref<HTMLElement | null>(null);
const pagesRef = ref<HTMLElement | null>(null);
const pagesViewportRef = ref<HTMLElement | null>(null);
const stateTick = ref(0);
const contentChangeSubscribers = new Set<(document: unknown) => void>();
const selectionChangeSubscribers = new Set<(selection: unknown) => void>();
const syncCoordinator = new SelectionBridge();
const showFindReplace = ref(false);
const showInsertImage = ref(false);
const showHyperlink = ref(false);
const showInsertSymbol = ref(false);
const showImageProperties = ref(false);
const showPageSetup = ref(false);
const showOutline = ref(props.showOutline);
const showKeyboardShortcuts = ref(false);
const showSidebar = ref(false);
const isAddingComment = ref(false);
const activeSidebarItem = ref<string | null>(null);
// Tree-shaped + reassigned wholesale: shallowRef avoids deep-proxying the
// Document-shaped Comment / TrackedChange / Heading payloads. Per the
// design's shallowRef contract (Decision 5/6) and notes/reactivity-review.md.
const comments = shallowRef<Comment[]>([]);
const trackedChanges = shallowRef<TrackedChangeEntry[]>([]);
const outlineHeadings = shallowRef<HeadingInfo[]>([]);

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
  installShortcuts: installZoomShortcuts,
  ZOOM_PRESETS,
} = useZoom(props.initialZoom);
installZoomShortcuts();

const {
  editorView,
  isReady,
  parseError,
  layout,
  loadBuffer,
  loadDocument: loadParsedDocument,
  save: saveBlob,
  focus,
  destroy,
  getDocument,
  getCommands,
  reLayout,
} = useDocxEditor({
  hiddenContainer: hiddenPmRef,
  pagesContainer: pagesRef,
  readOnly,
  externalPlugins: props.externalPlugins,
  syncCoordinator,
  onChange: (doc) => {
    emit('change', doc);
    emit('update:document', doc);
    contentChangeSubscribers.forEach((listener) => listener(doc));
  },
  onError: (err) => emit('error', err),
  onSelectionUpdate: () => {
    stateTick.value++;
    updateSelectionOverlay();
    const selection = getSelectionInfoImpl(editorView.value);
    selectionChangeSubscribers.forEach((listener) => listener(selection));
  },
});

// ─── Document-state derived computed refs ─────────────────────────────────
// Active section's properties drive the horizontal ruler (margins + indents).
// React reads `package.document.finalSectionProperties` for the same purpose;
// fall back to the first section's properties for older parses.
const currentSectionProps = computed(() => {
  void stateTick.value;
  const doc = getDocument();
  if (!doc?.package?.document) return null;
  const body = doc.package.document;
  return body.finalSectionProperties ?? body.sections?.[0]?.properties ?? null;
});

const documentTheme = computed(() => {
  void stateTick.value;
  return getDocument()?.package?.theme ?? props.theme ?? null;
});

// When the comments sidebar opens, shift the pages container (NOT the
// scrolling viewport) left by SIDEBAR_DOCUMENT_SHIFT. Applied on the
// inner `__pages` container so the viewport's scrollbar stays at the
// real right edge instead of moving with the page.
const pagesContainerStyle = computed(() => {
  const parts: string[] = [];
  if (showSidebar.value) parts.push(`translateX(-${SIDEBAR_DOCUMENT_SHIFT}px)`);
  if (zoom.value !== 1) parts.push(`scale(${zoom.value})`);
  return {
    transform: parts.length > 0 ? parts.join(' ') : undefined,
    transformOrigin: 'top center',
    transition: 'transform 0.2s ease',
  };
});

const rulerRowStyle = computed(() => ({
  paddingLeft: '20px',
  paddingRight: 20 + (showSidebar.value ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0) + 'px',
  transition: 'padding 0.2s ease',
}));

const pageWidthPx = computed(() => {
  const sp = currentSectionProps.value;
  return twipsToPixels(sp?.pageWidth ?? 12240) * zoom.value;
});

const resolvedCommentIds = computed(() => {
  const out = new Set<number>();
  for (const c of comments.value) {
    if (c.parentId == null && c.done) out.add(c.id);
  }
  return out;
});

const bookmarkOptions = computed(() => {
  void stateTick.value;
  const view = editorView.value;
  if (!view) return [];
  const seen = new Set<string>();
  const options: Array<{ name: string; label?: string }> = [];
  view.state.doc.descendants((node) => {
    const bookmarks = node.attrs?.bookmarks as Array<{ name?: string }> | undefined;
    if (!bookmarks) return true;
    for (const bookmark of bookmarks) {
      const name = bookmark.name;
      if (!name || name.startsWith('_') || seen.has(name)) continue;
      seen.add(name);
      options.push({ name, label: name });
    }
    return true;
  });
  return options.sort((a, b) => a.name.localeCompare(b.name));
});

// ─── Comment lifecycle (owns floating FAB + add/cancel flow + selection-
//     driven sidebar focus tracking + extract pipeline). Declared before
//     useFileIO so the IO layer can call extractCommentsAndChanges.
// ─────────────────────────────────────────────────────────────────────────
const {
  floatingCommentBtn,
  pendingCommentRange,
  addCommentYPosition,
  sidebarAutoOpenedRef,
  extractCommentsAndChanges,
  handleAddComment,
  handleCancelAddComment,
  handleStartAddComment,
  handleMarkerClick,
} = useCommentLifecycle({
  editorView,
  getDocument,
  comments,
  trackedChanges,
  resolvedCommentIds,
  activeSidebarItem,
  showSidebar,
  isAddingComment,
  readOnly,
  zoom,
  stateTick,
  pagesRef,
  pagesViewportRef,
  emit,
});

const {
  docxInputRef,
  handleDocxFileChange,
  handleDocumentNameChange,
  downloadCurrentDocument,
  emitReadyAfterSidebarStateRefresh,
  loadDocumentBuffer,
  loadDocument,
  save,
} = useFileIO({
  loadBuffer,
  loadParsedDocument,
  getDocument,
  saveBlob,
  extractCommentsAndChanges,
  emit,
  documentName: () => props.documentName,
  onDocumentNameChange: props.onDocumentNameChange,
  nextTick,
});

const {
  hyperlinkPopupData,
  handleHyperlinkSubmit,
  handleHyperlinkRemove,
  handleHyperlinkPopupNavigate,
  handleHyperlinkPopupEdit,
  handleHyperlinkPopupRemove,
} = useHyperlinkManagement({ editorView, getCommands });

const {
  handleClearFormatting,
  handleApplyStyle,
  handleInsertPageBreak,
  handleInsertSymbol,
  applyFormatting,
  setParagraphStyle,
} = useFormattingActions({ editorView, getDocument });

const {
  handlePageSetupApply,
  handleLeftMarginChange,
  handleRightMarginChange,
  handleTopMarginChange,
  handleBottomMarginChange,
  handleIndentLeftChange,
  handleIndentRightChange,
  handleFirstLineIndentChange,
  handleTabMarkRemove,
} = usePageSetupControls({ editorView, getDocument, readOnly, stateTick, reLayout, emit });

const {
  handleToggleOutline,
  handleOutlineNavigate,
  handleToggleSidebar,
  handleEditorScrollMouseDown,
} = useOutlineSidebar({
  editorView,
  showOutline,
  showSidebar,
  outlineHeadings,
  activeSidebarItem,
  extractCommentsAndChanges,
});

useKeyboardShortcuts({
  showKeyboardShortcuts,
  showFindReplace,
  showHyperlink,
  handleZoomKeyDown,
  disableFindReplaceShortcuts: () => props.disableFindReplaceShortcuts,
});

const {
  addComment,
  replyToComment,
  resolveComment,
  proposeChange,
  handleCommentReply,
  handleCommentUnresolve,
  handleCommentDelete,
  handleAcceptChange,
  handleRejectChange,
  handleTrackedChangeReply,
} = useCommentManagement({
  editorView,
  getDocument,
  comments,
  trackedChanges,
  showSidebar,
  isAddingComment,
  pendingCommentRange,
  contentChangeSubscribers,
  extractCommentsAndChanges,
  emit,
});

// ─── Composable order: useImageActions → usePagesPointer → useContextMenus
//     → useSelectionSync → useDocxEditorRefApi
//
//   • usePagesPointer / useContextMenus / useSelectionSync all consume the
//     `selectedImage` + `imageInteracting` refs from useImageActions, so
//     it has to come first.
//   • useContextMenus takes `resolvePos` / `setPmSelection` callbacks
//     produced by usePagesPointer, so usePagesPointer goes second.
//   • useSelectionSync is constructed last among the cluster because the
//     hoisted clearOverlay / updateSelectionOverlay wrappers below close
//     over `selectionSync` by name (see TDZ note where they're defined).
// ────────────────────────────────────────────────────────────────────────
const {
  selectedImage,
  imageInteracting,
  imageToolbarContext,
  handleInsertImage,
  handleToolbarImageWrap,
  handleImageTransform,
} = useImageActions({ editorView, zoom, stateTick, getCommands });

// Table resize handlers — port of React PagedEditor.tsx column/row/right-edge
// resize. tryStartResize() runs from handlePagesMouseDown; install() wires
// global mousemove/mouseup that drives the drag and commits the PM transaction.
const tableResize = useTableResize();
let tableResizeCleanup: (() => void) | null = null;

const {
  tableInsertButton,
  hfEdit,
  scrollPageInfo,
  resolvePos,
  setPmSelection,
  scrollVisiblePositionIntoView,
  handlePagesMouseDown,
  handlePagesMouseMove,
  handlePagesClick,
  handlePagesDoubleClick,
  handleTableInsertClick,
  clearTableInsertTimer,
  handleHfSave,
  handleHfRemove,
} = usePagesPointer({
  editorView,
  pagesRef,
  pagesViewportRef,
  selectedImage,
  imageInteracting,
  hyperlinkPopupData,
  readOnly,
  zoom,
  layout,
  tableResize,
  getCommands,
  getDocument,
  reLayout,
  emit,
  clearOverlay,
});

const {
  contextMenu,
  imageContextMenu,
  imageContextMenuTextActions,
  handleContextMenu,
  handleSelectedImageContextMenu,
  handleImageWrapSelect,
  handleContextMenuAction,
} = useContextMenus({
  editorView,
  selectedImage,
  zoom,
  showImageProperties,
  getCommands,
  clearOverlay,
  setPmSelection,
  resolvePos,
});

const { handleMenuAction, handleMenuTableInsert } = useMenuActions({
  editorView,
  getCommands,
  docxInputRef,
  showPageSetup,
  showInsertImage,
  showHyperlink,
  showInsertSymbol,
  showKeyboardShortcuts,
  handleClearFormatting,
  handleInsertPageBreak,
  handleToggleOutline,
  handleToggleSidebar,
  downloadCurrentDocument,
  emit,
});

useDocumentLifecycle({
  documentBuffer: () => props.documentBuffer,
  document: () => props.document,
  loadDocumentBuffer,
  loadDocument,
  sidebarAutoOpenedRef,
});

const getEditorViewForDecorations = () => editorView.value;
const getPagesContainerForDecorations = () => pagesRef.value;

watch(
  () => props.mode,
  (mode) => {
    if (mode && mode !== editorMode.value) editorMode.value = mode;
  }
);

watch(
  () => props.showOutline,
  (next) => {
    showOutline.value = !!next;
  }
);

function setEditorMode(mode: EditorMode) {
  if (editorMode.value === mode) return;
  editorMode.value = mode;
  emit('mode-change', mode);
}

onMounted(() => {
  tableResizeCleanup = tableResize.install();
});

onBeforeUnmount(() => {
  tableResizeCleanup?.();
});

// =========================================================================
// Selection & caret overlay — useSelectionSync owns the implementation.
//
// These wrappers MUST stay as hoisted `function` declarations. The
// `useDocxEditor({ onSelectionUpdate })` call earlier in this script
// closes over `updateSelectionOverlay` by name; if these were rewritten
// as `const updateSelectionOverlay = ...`, the closure would TDZ-crash
// because `useDocxEditor` runs before `useSelectionSync` here. Function
// declarations are hoisted, so the closure resolves at call time
// (after script-setup finishes and `selectionSync` exists).
// =========================================================================

function clearOverlay() {
  selectionSync.clearOverlay();
}

function updateSelectionOverlay() {
  selectionSync.updateSelectionOverlay();
}

const selectionSync = useSelectionSync({ editorView, pagesRef, selectedImage });

onBeforeUnmount(() => {
  clearOverlay();
});

// Ref-API assembly — single source of truth for the surface
// described by `DocxEditorRef`. `satisfies DocxEditorRef` lives
// inside `useDocxEditorRefApi` so signature drift is caught at
// composable-build time.
const { exposed } = useDocxEditorRefApi({
  editorView,
  layout,
  pagesRef,
  pagesViewportRef,
  zoom,
  comments,
  focus,
  destroy,
  getDocument,
  setZoom,
  save,
  loadDocument,
  loadDocumentBuffer,
  addComment,
  replyToComment,
  resolveComment,
  proposeChange,
  applyFormatting,
  setParagraphStyle,
  scrollVisiblePositionIntoView,
  contentChangeSubscribers,
  selectionChangeSubscribers,
  onPrint: props.onPrint,
});
defineExpose(exposed);
</script>

<style src="./DocxEditorVue.css"></style>
