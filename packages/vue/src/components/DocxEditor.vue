<template>
  <div
    :class="[
      'docx-editor-vue ep-root paged-editor',
      isDark ? 'dark' : '',
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
    <div class="docx-editor-vue__toolbar-shell">
      <DocxEditorMenuBar
        :show-menu-bar="showMenuBar"
        :document-name="documentName"
        :document-name-editable="documentNameEditable"
        :show-file-open="showFileOpen"
        :show-help-menu="showHelpMenu"
        :render-logo="renderLogo"
        :render-title-bar-right="renderTitleBarRight"
        @rename="handleDocumentNameChange"
        @menu-action="handleMenuAction"
        @insert-table="handleMenuTableInsert"
      >
        <template #title-bar-left><slot name="title-bar-left" /></template>
        <template #title-bar-right><slot name="title-bar-right" /></template>
      </DocxEditorMenuBar>

      <Toolbar
        v-if="showToolbar"
        :view="activeFormattingView"
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
        :document-fonts="documentFonts"
        :document-styles="documentStyles"
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
            :view="activeFormattingView"
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
      v-model:show-hyperlink="showHyperlink"
      v-model:show-insert-symbol="showInsertSymbol"
      v-model:show-image-properties="showImageProperties"
      v-model:show-page-setup="showPageSetup"
      v-model:show-watermark="showWatermark"
      v-model:show-keyboard-shortcuts="showKeyboardShortcuts"
      :view="editorView"
      :bookmarks="bookmarkOptions"
      :selected-image-pm-pos="selectedImage?.pmPos ?? null"
      :section-properties="currentSectionProps"
      :current-watermark="currentWatermark"
      :watermark-presets="watermarkPresets"
      :scroll-visible-position-into-view="scrollVisiblePositionIntoView"
      @insert-symbol="handleInsertSymbol"
      @hyperlink-submit="handleHyperlinkSubmit"
      @hyperlink-remove="handleHyperlinkRemove"
      @page-setup-apply="handlePageSetupApply"
      @watermark-apply="handleWatermarkApply"
    />

    <div v-if="parseError" class="docx-editor-vue__error">
      {{ parseError }}
    </div>

    <div v-if="!isReady && !parseError" class="docx-editor-vue__loading">Loading...</div>

    <!-- Portal body PM to document.body so focus cannot scroll the paged scroller. -->
    <Teleport to="body">
      <div ref="hiddenPmRef" class="docx-editor-vue__hidden-pm paged-editor__hidden-pm" />
    </Teleport>

    <div class="docx-editor-vue__editor-scroll" @mousedown="handleEditorScrollMouseDown">
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
          <div
            v-if="showRuler && currentSectionProps"
            class="docx-editor-vue__ruler-row"
            :style="rulerRowStyle"
          >
            <HorizontalRuler
              :section-props="currentSectionProps"
              :zoom="zoom"
              :editable="!readOnly"
              :indent-left="rulerIndents.indentLeft"
              :indent-right="rulerIndents.indentRight"
              :first-line-indent="rulerIndents.firstLineIndent"
              :hanging-indent="rulerIndents.hangingIndent"
              :tab-stops="rulerIndents.tabMarks"
              @left-margin-change="handleLeftMarginChange"
              @right-margin-change="handleRightMarginChange"
              @indent-left-change="handleIndentLeftChange"
              @indent-right-change="handleIndentRightChange"
              @first-line-indent-change="handleFirstLineIndentChange"
              @tab-stop-remove="handleTabMarkRemove"
            />
          </div>

          <div
            class="docx-editor-vue__editor-content-wrapper"
            :style="{
              position: 'relative',
              display: 'flex',
              flex: '1 0 auto',
              flexDirection: 'column',
              height: visualPagesHeight + 'px',
              minHeight: visualPagesHeight + 'px',
              minWidth: minLayoutWidth + 'px',
              overflow: 'hidden',
            }"
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
              @comment-resolve="handleCommentResolve"
              @comment-unresolve="handleCommentUnresolve"
              @comment-delete="handleCommentDelete"
              @accept-change="handleAcceptChange"
              @reject-change="handleRejectChange"
              @accept-change-by-id="handleAcceptChangeById"
              @reject-change-by-id="handleRejectChangeById"
              @tracked-change-reply="handleTrackedChangeReply"
              @update:active-item-id="(id: string | null) => (activeSidebarItem = id)"
            />
          </div>

          <ContentControlWidgets v-if="!readOnly" :container="pagesRef" :view="editorView" />

          <InlineHeaderFooterEditor
            :is-open="hfEdit !== null"
            :position="hfEdit?.position ?? 'header'"
            :view="activeHfView"
            :target-rect="hfEdit?.targetRect ?? null"
            @save="handleHfSave"
            @close="hfEdit = null"
            @remove="handleHfRemove"
          />

          <div
            v-for="(rect, i) in hfEdit ? hfSelectionGeometry : []"
            :key="`hf-sel-${i}-${rect.top}-${rect.left}`"
            class="vue-hf-sel-rect"
            aria-hidden="true"
            :style="{
              position: 'fixed',
              top: `${rect.top}px`,
              left: `${rect.left}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              background: 'var(--doc-selection)',
              pointerEvents: 'none',
              zIndex: 9998,
            }"
          />

          <div
            v-if="hfEdit && hfCaretRect"
            aria-hidden="true"
            :style="{
              position: 'fixed',
              top: `${hfCaretRect.top}px`,
              left: `${hfCaretRect.left}px`,
              width: '2px',
              height: `${hfCaretRect.height}px`,
              background: '#4285f4',
              pointerEvents: 'none',
              zIndex: 9999,
              animation: 'hf-caret-blink 1.06s steps(1) infinite',
            }"
          />

          <ImageSelectionOverlay
            :image-info="selectedImage"
            :zoom="zoom"
            :view="activeFormattingView"
            :pages-are-current="paintedPagesAreCurrent"
            :request-overlay-refresh="requestOverlayRefresh"
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
            :transaction-version="paintedOverlayTick"
            :pages-are-current="paintedPagesAreCurrent"
          />

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

          <HyperlinkPopup
            :data="hyperlinkPopupData"
            :read-only="readOnly"
            @navigate="handleHyperlinkPopupNavigate"
            @copy="hyperlinkPopupData = null"
            @edit="handleHyperlinkPopupEdit"
            @remove="handleHyperlinkPopupRemove"
            @close="hyperlinkPopupData = null"
          />
        </div>

        <OutlineToggleButton
          v-if="!showOutline && showOutlineButton"
          :left-offset="showRuler ? 12 + 20 : 12"
          :top-px="showRuler ? 24 + 30 : 24"
          @toggle="handleToggleOutline"
        />

        <PageIndicator
          v-if="scrollPageInfo.totalPages > 1"
          :current-page="scrollPageInfo.currentPage"
          :total-pages="scrollPageInfo.totalPages"
          :visible="scrollPageInfo.visible"
        />

        <DocumentOutline
          :is-open="showOutline"
          :headings="outlineHeadings"
          :left-offset="showRuler ? 12 + 20 : 12"
          :top-px="showRuler ? 24 + 30 : 24"
          @close="showOutline = false"
          @navigate="handleOutlineNavigate"
        />
      </div>
    </div>

    <input
      ref="docxInputRef"
      type="file"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      style="display: none"
      @change="handleDocxFileChange"
    />
    <input
      ref="imageInputRef"
      type="file"
      accept="image/*"
      style="display: none"
      @change="handleImageFileChange"
    />

    <DocxEditorOverlays
      :read-only="readOnly"
      :context-menu="contextMenu"
      :image-context-menu="imageContextMenu"
      :image-context-menu-text-actions="imageContextMenuTextActions"
      :can-open-image-properties="!!selectedImage"
      @context-menu-action="handleContextMenuAction"
      @close-context-menu="contextMenu.isOpen = false"
      @image-wrap-select="handleImageWrapSelect"
      @close-image-context-menu="imageContextMenu = null"
      @open-image-properties="showImageProperties = true"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import {
  computeHfCaretRectFromView,
  readHfSelectionGeometry,
} from '@docx-editor.dev/core/flow-model';
import { getSelectionInfo as getSelectionInfoImpl } from '../utils/refApiQueries';
import { computeVisualPagesHeight } from '../utils/visualPagesHeight';
import { extractSelectionState } from '@docx-editor.dev/core/prosemirror';
import { nearestHfHostEl } from '../utils/domQueries';
import Toolbar from './Toolbar.vue';
import TableToolbar from './ui/TableToolbar.vue';
import DecorationLayer from './DecorationLayer.vue';
import ImageSelectionOverlay from './ImageSelectionOverlay.vue';
import DocumentOutline from './DocumentOutline.vue';
import OutlineToggleButton from './OutlineToggleButton.vue';
import UnifiedSidebar from './UnifiedSidebar.vue';
import CommentMarginMarkers from './CommentMarginMarkers.vue';
import MaterialSymbol from './ui/MaterialSymbol.vue';
import PageIndicator from './PageIndicator.vue';
import InlineHeaderFooterEditor from './InlineHeaderFooterEditor.vue';
import ContentControlWidgets from './ContentControlWidgets.vue';
import HorizontalRuler from './ui/HorizontalRuler.vue';
import VerticalRuler from './ui/VerticalRuler.vue';
import DocxEditorMenuBar from './DocxEditor/DocxEditorMenuBar.vue';
import DocxEditorDialogs from './DocxEditor/DocxEditorDialogs.vue';
import DocxEditorOverlays from './DocxEditor/DocxEditorOverlays.vue';
import HyperlinkPopup from './ui/HyperlinkPopup.vue';
import type { TrackedChangeEntry } from './sidebar/sidebarUtils';
import type { EditorMode, DocxEditorProps } from './DocxEditor/types';
import { useDocxEditor } from '../composables/useDocxEditor';
import { useZoom } from '../composables/useZoom';
import { useTableResize } from '../composables/useTableResize';
import { useFileIO } from '../composables/useFileIO';
import { useHyperlinkManagement } from '../composables/useHyperlinkManagement';
import { useFormattingActions } from '../composables/useFormattingActions';
import { usePageSetupControls } from '../composables/usePageSetupControls';
import { useWatermarkControls } from '../composables/useWatermarkControls';
import { useOutlineSidebar } from '../composables/useOutlineSidebar';
import { useKeyboardShortcuts } from '../composables/useKeyboardShortcuts';
import { provideDocxPortalClass } from '../composables/usePortalClass';
import { useCommentManagement } from '../composables/useCommentManagement';
import { useHostCallbacks } from '../composables/useHostCallbacks';
import { useCommentLifecycle } from '../composables/useCommentLifecycle';
import { useImageActions } from '../composables/useImageActions';
import { useContextMenus } from '../composables/useContextMenus';
import { usePagesPointer } from '../composables/usePagesPointer';
import { useSelectionSync } from '../composables/useSelectionSync';
import { useMenuActions } from '../composables/useMenuActions';
import { useTableOfContentsActions } from '../composables/useTableOfContentsActions';
import { useDocumentLifecycle } from '../composables/useDocumentLifecycle';
import { usePainterOverlayRefresh } from '../composables/usePainterOverlayRefresh';
import { useEditorDocumentMetadata } from '../composables/useEditorDocumentMetadata';
import { useDocxEditorRefApi } from '../composables/useDocxEditorRefApi';
import { useControllableBoolean } from '../composables/useControllableBoolean';
import type { Document } from '@docx-editor.dev/core/types/document';
import type { Comment } from '@docx-editor.dev/core/types/content';
import type { HeadingInfo } from '@docx-editor.dev/core/utils/headingCollector';
import { createTranslator, provideLocale } from '../i18n';
import { twipsToPixels } from '@docx-editor.dev/core/utils/units';
import { SIDEBAR_DOCUMENT_SHIFT } from '@docx-editor.dev/core/utils';
import { useColorMode } from '../composables/useColorMode';
import { useFontLifecycle } from '../composables/useFontLifecycle';
import { createCommentIdAllocator } from '@docx-editor.dev/core/prosemirror/commentIdAllocator';

const props = withDefaults(defineProps<DocxEditorProps>(), {
  documentBuffer: null,
  document: null,
  showToolbar: true,
  showFileOpen: true,
  showHelpMenu: true,
  showMenuBar: true,
  showRuler: true,
  documentName: '',
  readOnly: false,
  author: 'User',
  mode: 'editing',
  // Explicit `undefined` default opts out of Vue's absent-Boolean-prop cast to
  // `false`; without it the sidebar reads as controlled-closed and never opens.
  commentsSidebarOpen: undefined,
  i18n: undefined,
  theme: null,
  colorMode: 'light',
  externalPlugins: () => [],
  showZoomControl: true,
  initialZoom: 1,
  toolbarExtra: undefined,
  className: '',
  style: undefined,
  showOutline: false,
  showOutlineButton: true,
  fontFamilies: undefined,
  watermarkPresets: undefined,
  onPrint: undefined,
  onOpen: undefined,
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
  (e: 'comments-sidebar-open-change', open: boolean): void;
}>();

const isDark = useColorMode(() => props.colorMode);

const editorMode = ref<EditorMode>(props.mode);
const readOnly = computed(() => props.readOnly || editorMode.value === 'viewing');
// Author for UI-created comments and tracked changes; threaded into the editor
// (suggestion-mode plugin) and the comment composables. (#720)
const authorRef = computed(() => props.author);

provideLocale(computed(() => props.i18n));
const { t } = createTranslator(computed(() => props.i18n));
// Share this `.ep-root`'s token scope + theme with <body>-teleported chrome.
provideDocxPortalClass(isDark);

const hiddenPmRef = ref<HTMLElement | null>(null);
const pagesRef = ref<HTMLElement | null>(null);
const pagesViewportRef = ref<HTMLElement | null>(null);
const stateTick = ref(0);
const paintedOverlayTick = ref(0);
const contentChangeSubscribers = new Set<(document: unknown) => void>();
const selectionChangeSubscribers = new Set<(selection: unknown) => void>();
let lastEmittedDocument: Document | null = null;
const showFindReplace = ref(false);
const showHyperlink = ref(false);
const showInsertSymbol = ref(false);
const showImageProperties = ref(false);
const showPageSetup = ref(false);
const showOutline = ref(props.showOutline);
const showKeyboardShortcuts = ref(false);
// Controlled by `commentsSidebarOpen` when set, else editor-owned; writes route
// through `onCommentsSidebarOpenChange`. Mirrors React's useControllableBoolean.
const showSidebar = useControllableBoolean(
  () => props.commentsSidebarOpen,
  (open) => emit('comments-sidebar-open-change', open)
);
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
  documentFonts,
  pageLayout,
  nodes,
  metrics,
  loadBuffer,
  loadDocument: loadParsedDocument,
  save: saveBlob,
  focus,
  destroy,
  getDocument,
  getCommands,
  reLayout,
  getHfPmView,
  getHfPmViews,
  syncHfPMs,
  setHfTransactionListener,
  setDocument,
} = useDocxEditor({
  hiddenContainer: hiddenPmRef,
  pagesContainer: pagesRef,
  readOnly,
  externalPlugins: props.externalPlugins,
  editorMode,
  author: authorRef,
  onChange: (doc) => {
    lastEmittedDocument = doc;
    emit('change', doc);
    emit('update:document', doc);
    props.onChange?.(doc);
    contentChangeSubscribers.forEach((listener) => listener(doc));
  },
  onError: (err) => {
    emit('error', err);
    props.onError?.(err);
  },
  onSelectionUpdate: () => {
    stateTick.value++;
    const view = editorView.value;
    // The prop mirrors React's `onSelectionChange`, which delivers a
    // `SelectionState` (formatting/style snapshot). The ref-API subscribers
    // keep Vue's existing `SelectionInfo` payload — a separate surface.
    props.onSelectionChange?.(view ? extractSelectionState(view.state) : null);
    const selection = getSelectionInfoImpl(view);
    selectionChangeSubscribers.forEach((listener) => listener(selection));
  },
});

// Host-facing comment callbacks + onEditorViewReady wiring (the `onComment*` /
// `onEditorViewReady` props), threaded into the comment composables below.
const { commentCallbacks } = useHostCallbacks(props, editorView);

const { currentSectionProps, rulerIndents, documentTheme, documentStyles } =
  useEditorDocumentMetadata(stateTick, editorView, getDocument, () => props.theme);

// HF caret overlay rect from the persistent HF view; shared with React via core's `computeHfCaretRectFromView`.
const hfCaretRect = ref<{ top: number; left: number; height: number } | null>(null);
// HF drag-selection rects — drawn when the user selects a range inside the
// painted header/footer. The body selection overlay is gated off in HF mode
// (`isHfEditing` in useSelectionSync), so without these the selection is set on
// the HF PM but never highlighted (#691). Shared with React via core's
// `readHfSelectionGeometry`.
const hfSelectionGeometry = ref<
  Array<{ top: number; left: number; width: number; height: number }>
>([]);

// Paint the HF caret + drag-selection rects from the live HF view together
// (mirror of React's `applyHfOverlay`). `computeHfCaretRectFromView` returns
// null for a non-empty selection and `readHfSelectionGeometry` returns
// [] for a collapsed one, so the caret and highlight are mutually exclusive.
function applyHfOverlay(view: EditorView, position: 'header' | 'footer') {
  const rId = hfEdit.value?.rId ?? null;
  hfCaretRect.value = computeHfCaretRectFromView(view, position, window.document, rId);
  hfSelectionGeometry.value = readHfSelectionGeometry(view, position, window.document, rId);
}
function clearHfOverlay() {
  hfCaretRect.value = null;
  hfSelectionGeometry.value = [];
}

useFontLifecycle(
  () => props.fonts,
  (err) => {
    emit('error', err);
    props.onError?.(err);
  }
);

// Memoized so the template doesn't walk the headers/footers Maps every tick.
const activeHfView = computed<EditorView | null>(() =>
  hfEdit.value?.headerFooter ? (getHfPmView(hfEdit.value.headerFooter) ?? null) : null
);

// Interactive toolbar formatting targets the edited header/footer, else body (#749).
const activeFormattingView = computed<EditorView | null>(
  () => activeHfView.value ?? editorView.value
);

// Registered in onMounted because `hfEdit` is destructured later in this script setup (TDZ).
onMounted(() => {
  setHfTransactionListener((_rId, _view) => {
    // Re-derive toolbar state against the HF selection (incl. selection-only
    // moves the HF dispatch never reports to stateTick) — parity with React (#749).
    stateTick.value++;
  });
  watch(
    () => {
      const edit = hfEdit.value;
      return edit ? `${edit.position}:${edit.rId ?? ''}:${edit.sectionIndex}` : null;
    },
    (editKey) => {
      if (!editKey) {
        clearHfOverlay();
        return;
      }
      // Collapse body PM selection + blur the body view so the user doesn't
      // see two carets (body + header) at once and stray keystrokes can't
      // land in the body before the HF view reclaims focus.
      const view = editorView.value;
      if (view) {
        try {
          const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, 0));
          view.dispatch(tr);
        } catch {
          // selection may be invalid mid-transition; overlay is gated on
          // `isHfEditing` so the body caret stays hidden anyway.
        }
        (view.dom as HTMLElement).blur?.();
      }
      // Force the selection overlay to re-render so the body caret disappears.
      requestOverlayRefresh();
    }
  );

  // HF caret uses position:fixed — recompute on scroll/resize so it follows the painted span.
  let rafScroll = 0;
  function onHfScroll() {
    if (!hfEdit.value || rafScroll) return;
    rafScroll = requestAnimationFrame(() => {
      rafScroll = 0;
      requestOverlayRefresh();
    });
  }
  window.addEventListener('scroll', onHfScroll, true);
  window.addEventListener('resize', onHfScroll);
  onBeforeUnmount(() => {
    if (rafScroll) cancelAnimationFrame(rafScroll);
    window.removeEventListener('scroll', onHfScroll, true);
    window.removeEventListener('resize', onHfScroll);
  });
});

const OUTLINE_RESERVED_SPACE = 268;
const OUTLINE_BUTTON_RESERVED_SPACE = 64;
const RULER_WIDTH = 20;
const DEFAULT_PAGE_WIDTH = 816;
const minLayoutWidth = computed(() => {
  void stateTick.value;
  const outlineLeftAllowance =
    (showOutline.value
      ? OUTLINE_RESERVED_SPACE
      : props.showOutlineButton
        ? OUTLINE_BUTTON_RESERVED_SPACE
        : 20) +
    (props.showRuler && (showOutline.value || props.showOutlineButton) ? RULER_WIDTH : 0);
  const doc = getDocument();
  const docBody = doc?.package?.document;
  const sectionPageWidths = [
    docBody?.finalSectionProperties?.pageWidth,
    ...(docBody?.sections?.map((s) => s.properties?.pageWidth) ?? []),
  ].filter((w): w is number => typeof w === 'number' && w > 0);
  const maxPageWidthPx = sectionPageWidths.length
    ? Math.round(Math.max(...sectionPageWidths) / 15)
    : DEFAULT_PAGE_WIDTH;
  return (
    2 * outlineLeftAllowance + maxPageWidthPx + (showSidebar.value ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0)
  );
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

const visualPagesHeight = computed(() =>
  computeVisualPagesHeight(pageLayout.value?.pages, zoom.value)
);

const rulerRowStyle = computed(() => ({
  paddingLeft: '20px',
  paddingRight: 20 + (showSidebar.value ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0) + 'px',
  transition: 'padding 0.2s ease',
  minWidth: minLayoutWidth.value + 'px',
}));

const pageWidthPx = computed(() => {
  const sp = currentSectionProps.value;
  return twipsToPixels(sp?.pageWidth ?? 12240) * zoom.value;
});

const resolvedCommentIds = computed(
  () => new Set(comments.value.filter((c) => c.parentId == null && c.done).map((c) => c.id))
);

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

// One comment/revision ID allocator per editor instance (monotonic, no reuse),
// shared by the comment lifecycle and management composables so comment and
// tracked-change IDs never collide.
const commentIdAllocator = createCommentIdAllocator();

// Comment lifecycle: declared before useFileIO so IO can call extractCommentsAndChanges.
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
  commentIdAllocator,
  author: authorRef,
  commentCallbacks,
  getHfPmViews,
});

const {
  docxInputRef,
  imageInputRef,
  handleImageFileChange,
  handleDocxFileChange,
  handleDocumentNameChange,
  downloadCurrentDocument,
  loadDocumentBuffer,
  loadDocument,
  save,
} = useFileIO({
  loadBuffer,
  onOpen: props.onOpen,
  loadParsedDocument,
  getDocument,
  saveBlob,
  extractCommentsAndChanges,
  emit,
  documentName: () => props.documentName,
  onDocumentNameChange: props.onDocumentNameChange,
  getActiveView: () => activeFormattingView.value,
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
  handleInsertSectionBreakNextPage,
  handleInsertSectionBreakContinuous,
  handleInsertSymbol,
  applyFormatting,
  setParagraphStyle,
  insertBreak,
} = useFormattingActions({ editorView, activeView: activeFormattingView, getDocument });

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

const { showWatermark, currentWatermark, handleWatermarkApply } = useWatermarkControls({
  editorView,
  readOnly,
  stateTick,
});

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
  // Deferred closure: `scrollVisiblePositionIntoView` is destructured from
  // usePagesPointer further down (TDZ-sensitive composable order). The arrow is
  // only invoked on an outline click, long after setup, so the reference is safe.
  scrollToVisiblePosition: (pmPos: number) => scrollVisiblePositionIntoView(pmPos),
});

useKeyboardShortcuts({
  showKeyboardShortcuts,
  showFindReplace,
  showHyperlink,
  handleZoomKeyDown,
  disableFindReplaceShortcuts: () => props.disableFindReplaceShortcuts,
  showFileOpen: () => props.showFileOpen,
  onOpenDocument: () => docxInputRef.value?.click(),
});

const {
  addComment,
  replyToComment,
  resolveComment,
  proposeChange,
  handleCommentReply,
  handleCommentResolve,
  handleCommentUnresolve,
  handleCommentDelete,
  handleAcceptChange,
  handleRejectChange,
  handleAcceptChangeById,
  handleRejectChangeById,
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
  commentIdAllocator,
  author: authorRef,
  commentCallbacks,
  getHfPmViews,
});

// Composable order (TDZ-sensitive): useImageActions → usePagesPointer → useContextMenus → useSelectionSync → useDocxEditorRefApi.
const {
  selectedImage,
  imageInteracting,
  imageToolbarContext,
  handleToolbarImageWrap,
  handleImageTransform,
} = useImageActions({ editorView: activeFormattingView, zoom, stateTick, getCommands });

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
  flushPendingImageSelection,
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
  pageLayout,
  tableResize,
  getCommands,
  getDocument,
  reLayout,
  emit,
  clearOverlay,
  pagesAreCurrent: paintedPagesAreCurrent,
  requestOverlayRefresh,
  syncHfPMs,
  getHfPmView,
  setDocument,
});

const { runTableOfContentsUpdate, handleInsertTableOfContents } = useTableOfContentsActions({
  editorView,
  layout: pageLayout,
  readOnly,
  t,
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
  editorView: activeFormattingView,
  selectedImage,
  zoom,
  showImageProperties,
  getCommands,
  layout: pageLayout,
  clearOverlay,
  setPmSelection,
  resolvePos,
  onUpdateTableOfContents: runTableOfContentsUpdate,
});

const { handleMenuAction, handleMenuTableInsert } = useMenuActions({
  editorView,
  getCommands,
  docxInputRef,
  imageInputRef,
  showPageSetup,
  showWatermark,
  showHyperlink,
  showInsertSymbol,
  showKeyboardShortcuts,
  handleClearFormatting,
  handleInsertPageBreak,
  handleInsertSectionBreakNextPage,
  handleInsertSectionBreakContinuous,
  handleInsertTOC: handleInsertTableOfContents,
  handleToggleOutline,
  handleToggleSidebar,
  downloadCurrentDocument,
  emit,
});

useDocumentLifecycle({
  documentBuffer: () => props.documentBuffer,
  document: () => props.document,
  currentDocument: getDocument,
  takeLastEmittedDocument: () => {
    const emitted = lastEmittedDocument;
    lastEmittedDocument = null;
    return emitted;
  },
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

// Selection & caret overlay — useSelectionSync owns the implementation.
// These wrappers MUST stay hoisted `function` declarations: `useDocxEditor`
// (above) closes over `updateSelectionOverlay` by name and runs before
// `useSelectionSync`, so a `const` form would TDZ-crash; hoisting resolves
// it at call time, after `selectionSync` exists.

function clearOverlay() {
  selectionSync.clearOverlay();
}

function updateSelectionOverlay() {
  selectionSync.updateSelectionOverlay();
}

function requestOverlayRefresh() {
  pagesRef.value?.dispatchEvent(new CustomEvent('docx-editor-vue:request-overlay-refresh'));
}

function paintedPagesAreCurrent() {
  return pagesRef.value?.dataset.overlayPagesCurrent === 'true';
}

function updateActiveHfOverlay() {
  const edit = hfEdit.value;
  if (!edit?.headerFooter) return;
  const view = getHfPmView(edit.headerFooter);
  if (!view) return;
  applyHfOverlay(view, edit.position);

  const hfEl = nearestHfHostEl(edit.position);
  const viewport = pagesViewportRef.value;
  if (!hfEl || !viewport) return;
  const el = hfEl.getBoundingClientRect();
  const vp = viewport.getBoundingClientRect();
  const z = zoom.value || 1;
  hfEdit.value = {
    ...edit,
    targetRect: {
      top: (el.top - vp.top + viewport.scrollTop) / z,
      left: (el.left - vp.left + viewport.scrollLeft) / z,
      width: el.width / z,
      height: el.height / z,
    },
  };
}

const isHfEditing = computed(() => hfEdit.value !== null);
const selectionSync = useSelectionSync({
  editorView,
  hiddenContainer: hiddenPmRef,
  pagesRef,
  zoom,
  selectedImage,
  isHfEditing,
  imageInteracting,
  readOnly,
  pageLayout,
  nodes,
  metrics,
  requestOverlayRefresh,
});

usePainterOverlayRefresh(
  pagesRef,
  () => {
    if (flushPendingImageSelection()) return;
    updateSelectionOverlay();
    paintedOverlayTick.value++;
  },
  updateActiveHfOverlay
);

onBeforeUnmount(() => {
  clearOverlay();
});

// Ref-API assembly; `useDocxEditorRefApi` catches signature drift at build time.
const { exposed } = useDocxEditorRefApi({
  editorView,
  pageLayout,
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
  onUpdateTableOfContents: runTableOfContentsUpdate,
  addComment,
  replyToComment,
  resolveComment,
  proposeChange,
  applyFormatting,
  setParagraphStyle,
  insertBreak,
  scrollVisiblePositionIntoView,
  contentChangeSubscribers,
  selectionChangeSubscribers,
  onPrint: props.onPrint,
});
defineExpose(exposed);
</script>
<style src="./DocxEditor.css"></style>
