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
      <!-- Title bar: GitHub badge slot, adapter switcher slot, document name, then File/Format/Insert/View menu bar -->
      <div v-if="showMenuBar" class="docx-editor-vue__title-bar">
        <div class="docx-editor-vue__title-bar-left">
          <component :is="renderLogo" v-if="renderLogo" />
          <slot name="title-bar-left" />
        </div>
        <div class="docx-editor-vue__title-bar-center">
          <DocumentName
            :model-value="documentName"
            :editable="documentNameEditable"
            @update:model-value="handleDocumentNameChange"
          />
          <MenuBar @action="handleMenuAction" @insert-table="handleMenuTableInsert" />
        </div>
        <div class="docx-editor-vue__title-bar-right">
          <slot name="title-bar-right" />
          <component :is="renderTitleBarRight" v-if="renderTitleBarRight" />
        </div>
      </div>

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

    <FindReplaceDialog
      :is-open="showFindReplace"
      :view="editorView"
      @close="showFindReplace = false"
    />

    <InsertImageDialog
      :is-open="showInsertImage"
      @close="showInsertImage = false"
      @insert="handleInsertImage"
    />

    <HyperlinkDialog
      :is-open="showHyperlink"
      :view="editorView"
      :bookmarks="bookmarkOptions"
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

    <div v-if="!isReady && !parseError" class="docx-editor-vue__loading">Loading...</div>

    <!-- Hidden ProseMirror (off-screen, receives keyboard input). Class
         matches React's PagedEditor so shared CSS attaches. -->
    <div ref="hiddenPmRef" class="docx-editor-vue__hidden-pm paged-editor__hidden-pm" />

    <!-- Editor scroll container: doc-bg wraps both the ruler row
         (centered + sticky) and the page area below. -->
    <div class="docx-editor-vue__editor-scroll" @mousedown="handleEditorScrollMouseDown">
      <!-- Horizontal ruler row: flex/justify-center so the ruler centers
           with the page; sticky-top so it stays visible during vertical
           scroll (matches React's `bg-doc-bg sticky top-0 py-1`).
           When the comments sidebar opens the page shifts left by
           SIDEBAR_DOCUMENT_SHIFT — bias `padding-right` by `2 *
           SIDEBAR_DOCUMENT_SHIFT` so the centered ruler tracks the page
           leftward in lockstep (same trick React uses). -->
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
        <!-- Visible pages (rendered by layout-painter). Class names are
           the same as React's PagedEditor so the shared editor.css
           rules (table layout, header/footer chrome, page break, etc.)
           apply byte-for-byte to both adapters. -->
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
          <!-- Vertical ruler — wrapped in an absolutely-positioned div
             because VerticalRuler's root has `position: relative`
             baked into its inline `containerStyle`, which would beat
             any class-based `position: absolute` and put the ruler in
             flow (taking 1056px of vertical space and pushing the
             page way down). The wrapper handles positioning so the
             ruler component itself stays self-contained. Mirrors
             React's `<div style={{position:absolute, left:0, top:0,
             paddingTop:48}}><VerticalRuler/></div>` pattern. -->
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

          <!-- Margin markers: small chat-bubble glyphs at the page right
             edge, visible when the sidebar is closed. Click → opens the
             sidebar focused on the comment. Mirrors React's
             CommentMarginMarkers.tsx. -->
          <CommentMarginMarkers
            :comments="comments"
            :pages-container="pagesRef"
            :zoom="zoom"
            :page-width-px="pageWidthPx"
            :sidebar-open="showSidebar"
            :resolved-comment-ids="resolvedCommentIds"
            @marker-click="handleMarkerClick"
          />

          <!-- Sidebar lives INSIDE the scroll container so it scrolls
             with the page (matches React's UnifiedSidebar mounting
             point inside the editor-content area). It positions
             itself absolutely next to the page right edge via
             pageWidthPx so cards anchor to their target spans. -->
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
            :active-item-id="activeSidebarItem"
            @update:active-item-id="(id: string | null) => (activeSidebarItem = id)"
          />
        </div>

        <!-- Outline toggle — absolutely positioned at the top-left of
           the editor area so the icon visually aligns with the top of
           the first page. Hidden while the outline panel is open;
           click reopens the panel. -->
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

        <!-- Page indicator overlays the visible right-mid edge of the
           editor area. Mounted as a sibling of the scrolling
           pages-viewport so it stays pinned via `position: absolute`
           regardless of scroll. -->
        <PageIndicator
          v-if="scrollPageInfo.totalPages > 1"
          :current-page="scrollPageInfo.currentPage"
          :total-pages="scrollPageInfo.totalPages"
          :visible="scrollPageInfo.visible"
        />

        <!-- Document outline panel — overlays the left edge of the
           editor area (NOT in flex flow) so it slides in over the
           page without pushing content around. Mounted inside
           `__editor-area` (which is `position: relative`) so the
           panel's `position: absolute` resolves against the page
           area. -->
        <DocumentOutline
          :is-open="showOutline"
          :headings="outlineHeadings"
          @close="showOutline = false"
          @navigate="handleOutlineNavigate"
        />
      </div>
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
      :on-image="contextMenu.onImage"
      :can-merge-cells="contextMenu.canMergeCells"
      :can-split-cell="contextMenu.canSplitCell"
      @action="handleContextMenuAction"
      @close="contextMenu.isOpen = false"
    />

    <ImageContextMenu
      :state="imageContextMenu"
      :text-actions="imageContextMenuTextActions"
      :can-open-properties="!!selectedImage"
      @close="imageContextMenu = null"
      @select="handleImageWrapSelect"
      @text-action="handleContextMenuAction"
      @open-properties="showImageProperties = true"
    />

    <!-- Hyperlink popup — surfaces on single-click of an external
         hyperlink. Internal bookmark links (href="#name") are not
         routed through here; PagedEditor's keyboard path handles
         those. -->
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
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { getSelectionInfo as getSelectionInfoImpl } from '../utils/refApiQueries';
import Toolbar from './Toolbar.vue';
import FindReplaceDialog from './dialogs/FindReplaceDialog.vue';
import TableToolbar from './ui/TableToolbar.vue';
import InsertImageDialog from './dialogs/InsertImageDialog.vue';
import HyperlinkDialog from './dialogs/HyperlinkDialog.vue';
import InsertSymbolDialog from './dialogs/InsertSymbolDialog.vue';
import DecorationLayer from './DecorationLayer.vue';
import ImageSelectionOverlay from './ImageSelectionOverlay.vue';
import type { ImageSelectionInfo } from './imageSelectionTypes';
import ImagePropertiesDialog from './dialogs/ImagePropertiesDialog.vue';
import PageSetupDialog from './dialogs/PageSetupDialog.vue';
import DocumentOutline from './DocumentOutline.vue';
import KeyboardShortcutsDialog from './dialogs/KeyboardShortcutsDialog.vue';
import TextContextMenu from './TextContextMenu.vue';
import ImageContextMenu from './ImageContextMenu.vue';
import type { ImageContextMenuState } from './imageContextMenuTypes';
import HyperlinkPopup, { type HyperlinkPopupData } from './ui/HyperlinkPopup.vue';
import UnifiedSidebar from './UnifiedSidebar.vue';
import CommentMarginMarkers from './CommentMarginMarkers.vue';
import MaterialSymbol from './ui/MaterialSymbol.vue';
import PageIndicator from './PageIndicator.vue';
import InlineHeaderFooterEditor from './InlineHeaderFooterEditor.vue';
import type { EditorMode } from '../editor-mode';
import MenuBar from './MenuBar.vue';
import DocumentName from './DocumentName.vue';
import HorizontalRuler from './ui/HorizontalRuler.vue';
import VerticalRuler from './ui/VerticalRuler.vue';
import type { TrackedChangeEntry } from './sidebar/sidebarUtils';
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
import { useImageActions } from '../composables/useImageActions';
import { useContextMenus } from '../composables/useContextMenus';
import { usePagesPointer } from '../composables/usePagesPointer';
import { useSelectionSync } from '../composables/useSelectionSync';
import { useDocxEditorRefApi } from '../composables/useDocxEditorRefApi';
import type { EditorView } from 'prosemirror-view';
import type { Document, SectionProperties } from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { collectHeadings } from '@eigenpal/docx-editor-core/utils/headingCollector';
import type { HeadingInfo } from '@eigenpal/docx-editor-core/utils/headingCollector';
import { collectBodySpans } from '@eigenpal/docx-editor-core/layout-bridge';
import { createTranslator, provideLocale } from '../i18n';
import { twipsToPixels } from '@eigenpal/docx-editor-core/utils/units';
import { extractTrackedChanges } from '@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges';
import { openReportIssue } from '@eigenpal/docx-editor-core/utils/reportIssue';
import {
  setIndentLeft,
  setIndentRight,
  setIndentFirstLine,
  removeTabMark,
} from '@eigenpal/docx-editor-core/prosemirror/commands/paragraph';
import { acceptChange, rejectChange } from '@eigenpal/docx-editor-core/prosemirror/commands';
import { SIDEBAR_DOCUMENT_SHIFT } from '@eigenpal/docx-editor-core/utils';
import { SelectionBridge } from '@eigenpal/docx-editor-core/prosemirror';
import type { DocxEditorProps } from '../docx-editor-props';

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

// Editor mode (editing / suggesting / viewing) — mirrors React's
// EditorMode prop and three-mode dropdown. Defaults to "editing".
const editorMode = ref<EditorMode>(props.mode);
const readOnly = computed(() => props.readOnly || editorMode.value === 'viewing');

// `useTranslation()` is imported above; the rest of the host (and the
// computed at line ~706 building the image-context-menu items) needs
// `t` in scope. Without this destructure, every render of the image
// menu throws `t is not defined` and tears down the entire editor.
provideLocale(computed(() => props.i18n));
const { t } = createTranslator(computed(() => props.i18n));

// Active section's properties drive the horizontal ruler (margins + indents).
// Re-runs whenever the document model is reassigned via stateTick.
// React reads `package.document.finalSectionProperties` for the same purpose;
// fall back to the first section's properties for older parses.
const currentSectionProps = computed(() => {
  void stateTick.value;
  const doc = getDocument();
  if (!doc?.package?.document) return null;
  const body = doc.package.document;
  return body.finalSectionProperties ?? body.sections?.[0]?.properties ?? null;
});

// Document theme — feeds the toolbar's color-picker theme matrix.
const documentTheme = computed(() => {
  void stateTick.value;
  return getDocument()?.package?.theme ?? props.theme ?? null;
});

// When the comments sidebar opens, shift the pages container (NOT the
// scrolling viewport) left by SIDEBAR_DOCUMENT_SHIFT. Applied on the
// inner `__pages` container so the viewport's scrollbar stays at the
// real right edge instead of moving with the page. The horizontal
// ruler stays in lockstep via `rulerRowStyle` below — `padding-right`
// gets a `2 * SIDEBAR_DOCUMENT_SHIFT` bias that pulls the centered
// ruler leftward by the same amount.
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

// Page width in CSS pixels (post-zoom). Used by UnifiedSidebar to anchor
// itself next to the page right-edge.
const pageWidthPx = computed(() => {
  const sp = currentSectionProps.value;
  return twipsToPixels(sp?.pageWidth ?? 12240) * zoom.value;
});

// Resolved comment ids — derived from the comments ref so the margin
// markers can render the resolved-vs-active glyph correctly. Mirrors
// React's resolvedCommentIds Set computed in DocxEditor.tsx.
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

function handleMarkerClick(_commentId: number) {
  // Mirrors React: marker click opens the sidebar; the card itself
  // re-anchors to the click target via the comment-id selector.
  showSidebar.value = true;
}

// Floating "Add comment" button state — initialised here, populated
// by recomputeFloatingCommentBtn() (declared further down, after
// useDocxEditor / useZoom run, so it has access to editorView /
// stateTick / zoom). All bound to template above.
const floatingCommentBtn = ref<{ top: number; left: number } | null>(null);
const pendingCommentRange = ref<{ from: number; to: number } | null>(null);

// Currently expanded sidebar item id — controlled by both clicks
// (UnifiedSidebar's update:activeItemId emit) and cursor-driven
// detection (recomputeActiveSidebarItem below).
const activeSidebarItem = ref<string | null>(null);

// Click in the grey gutter around the page → collapse any expanded
// sidebar card. Clicks on the doc body already collapse via the
// cursor-mark detector (`recomputeActiveSidebarItem`); clicks inside
// the sidebar are real interactions with the card itself, so we let
// those through.

// Hidden file input that backs the File > Open menu action. Lets
// users open a document straight from the menu without the host
// having to wire its own picker.

function handleMenuAction(action: string) {
  switch (action) {
    case 'open':
      // Trigger the hidden file picker. Host can still listen for
      // `@menu-action="open"` if it wants to override.
      docxInputRef.value?.click();
      emit('menu-action', 'open');
      break;
    case 'save':
      // Re-emit so hosts can intercept (e.g. send to a backend instead
      // of a download). When no host handler runs synchronously to
      // call `event.preventDefault`, fall through and download the
      // produced .docx Blob ourselves.
      emit('menu-action', 'save');
      void downloadCurrentDocument();
      break;
    case 'pageSetup':
      showPageSetup.value = true;
      break;
    case 'clearFormatting':
      handleClearFormatting();
      break;
    case 'insertImage':
      showInsertImage.value = true;
      break;
    case 'insertLink':
      showHyperlink.value = true;
      break;
    case 'insertSymbol':
      showInsertSymbol.value = true;
      break;
    case 'insertPageBreak':
      handleInsertPageBreak();
      break;
    case 'insertTOC':
      execSimpleCommand('generateTOC');
      break;
    case 'outline':
      handleToggleOutline();
      break;
    case 'sidebar':
      handleToggleSidebar();
      break;
    case 'shortcuts':
      showKeyboardShortcuts.value = true;
      break;
    case 'reportIssue':
      openReportIssue();
      break;
    case 'dirLTR':
      execSimpleCommand('setLtr');
      break;
    case 'dirRTL':
      execSimpleCommand('setRtl');
      break;
  }
}




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
// Tree-shaped + reassigned wholesale: shallowRef avoids deep-proxying the
// Document-shaped Comment / TrackedChange / Heading payloads. Per the
// design's shallowRef contract (Decision 5/6) and notes/reactivity-review.md.
const comments = shallowRef<Comment[]>([]);
const trackedChanges = shallowRef<TrackedChangeEntry[]>([]);
// Single-click on a hyperlink surfaces a popup with copy / edit /
// unlink. Cleared on selection change, escape, or click-outside.
// Owned by useHyperlinkManagement below; destructured into scope so the
// existing watch / event handlers can keep reading it directly.

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
// Wire global Ctrl+= / Ctrl+- / Ctrl+0 — matches React's useWheelZoom.
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
  extractCommentsAndChanges: () => extractCommentsAndChanges(),
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
  extractCommentsAndChanges: () => extractCommentsAndChanges(),
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
  extractCommentsAndChanges: () => extractCommentsAndChanges(),
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


// ─── Floating "Add comment" button — recompute logic ──────────────────────
// Lives here (after useDocxEditor / useZoom) so it can access editorView /
// stateTick / zoom / isAddingComment / pagesRef without hitting a
// temporal dead zone in script-setup top-to-bottom evaluation.
function recomputeFloatingCommentBtn() {
  void stateTick.value; // dependency — re-runs on every PM transaction
  const view = editorView.value;
  if (!view || isAddingComment.value || readOnly.value) {
    floatingCommentBtn.value = null;
    return;
  }
  const { from, to } = view.state.selection;
  if (from === to) {
    floatingCommentBtn.value = null;
    return;
  }
  // The FAB is rendered as a child of `pages-viewport`, which is
  // UNSCALED (only the inner `__pages` carries the
  // translateX/scale transform). All position math is in pages-
  // viewport coords — `getBoundingClientRect` already returns
  // post-transform CSS px, so no /zoom adjustments are needed; we
  // just convert from viewport-window space into viewport-relative
  // space (subtract the viewport's own bounding-rect origin) and add
  // the viewport's scrollTop for the absolute child's `top:`.
  const pagesContainer = pagesRef.value;
  const viewport = pagesViewportRef.value;
  if (!pagesContainer || !viewport) {
    floatingCommentBtn.value = null;
    return;
  }
  const viewportRect = viewport.getBoundingClientRect();
  let top: number | null = null;
  // Scope to body PM spans — HF parses to a separate PM document, so
  // an unscoped `[data-doc-from]` lookup would match HF runs whose
  // positions collide with body positions and place the floating
  // comment button next to a header rather than the actual selection.
  // Mirrors the React fix from #406 / #408.
  for (const el of collectBodySpans(pagesContainer)) {
    const start = Number(el.dataset.docFrom);
    const end = Number(el.dataset.docTo);
    if (from >= start && from <= end) {
      const r = el.getBoundingClientRect();
      top = r.top - viewportRect.top + viewport.scrollTop;
      break;
    }
  }
  if (top == null) {
    floatingCommentBtn.value = null;
    return;
  }
  const pageEl = pagesContainer.querySelector<HTMLElement>('.layout-page');
  if (!pageEl) {
    floatingCommentBtn.value = null;
    return;
  }
  const pageRect = pageEl.getBoundingClientRect();
  const left = pageRect.right - viewportRect.left + 8;
  floatingCommentBtn.value = { top, left };
}

watch([stateTick, () => isAddingComment.value, () => zoom.value], () =>
  recomputeFloatingCommentBtn()
);

// Cursor-driven sidebar expand. When the cursor lands on a span
// covered by a comment / insertion / deletion mark, auto-expand
// the matching sidebar card (and open the sidebar if it isn't
// already).
function recomputeActiveSidebarItem() {
  void stateTick.value;
  const view = editorView.value;
  if (!view) return;
  const $from = view.state.selection.$from;
  const marks = [
    ...(view.state.storedMarks ?? []),
    ...($from.nodeAfter?.marks ?? []),
    ...($from.nodeBefore?.marks ?? []),
    ...$from.marks(),
  ];
  let nextItem: string | null = null;
  for (const mark of marks) {
    if (mark.type.name === 'comment' && mark.attrs.commentId != null) {
      const cid = mark.attrs.commentId as number;
      // Skip resolved threads + the pending -1 placeholder so the
      // sidebar doesn't refocus while the user is typing in
      // AddCommentCard.
      if (cid === -1) continue;
      if (resolvedCommentIds.value.has(cid)) continue;
      nextItem = `comment-${cid}`;
      break;
    }
    if (
      (mark.type.name === 'insertion' || mark.type.name === 'deletion') &&
      mark.attrs.revisionId != null
    ) {
      const revId = String(mark.attrs.revisionId);
      const prefix = `tc-${revId}-`;
      // Walk current trackedChanges items to find the matching id
      // (they're keyed `tc-<rev>-<index>`).
      const match = trackedChanges.value.findIndex(
        (c) => String(c.revisionId) === revId || String(c.insertionRevisionId ?? '') === revId
      );
      if (match >= 0) {
        nextItem = `tc-${trackedChanges.value[match].revisionId}-${match}`;
        if (nextItem.startsWith(prefix) === false) {
          // Replacement card: card id keys off the deletion's
          // revisionId, not the insertion's. The findIndex above
          // already resolved both directions.
        }
        break;
      }
    }
  }
  if (nextItem) {
    showSidebar.value = true;
  }
  activeSidebarItem.value = nextItem;
}

watch(stateTick, () => recomputeActiveSidebarItem());

let floatingResizeObserver: ResizeObserver | null = null;
onMounted(() => {
  floatingResizeObserver = new ResizeObserver(() => recomputeFloatingCommentBtn());
  if (pagesRef.value) floatingResizeObserver.observe(pagesRef.value);
  window.addEventListener('resize', recomputeFloatingCommentBtn);
});
onBeforeUnmount(() => {
  floatingResizeObserver?.disconnect();
  window.removeEventListener('resize', recomputeFloatingCommentBtn);
});

function handleStartAddComment() {
  const view = editorView.value;
  if (!view) return;
  const { from, to } = view.state.selection;
  if (from === to) return;
  pendingCommentRange.value = { from, to };
  // Capture the floating button's Y so the AddCommentCard renders
  // anchored to the selection, not at the top of the rail.
  addCommentYPosition.value = floatingCommentBtn.value?.top ?? null;
  // Stamp a pending comment mark (commentId: -1) over the selection
  // so the layout-painter writes [data-comment-id] right away — the
  // user sees the yellow highlight immediately instead of waiting
  // for submit.
  const commentMark = view.state.schema.marks.comment;
  if (commentMark) {
    const tr = view.state.tr.addMark(from, to, commentMark.create({ commentId: -1 }));
    view.dispatch(tr);
  }
  showSidebar.value = true;
  isAddingComment.value = true;
  floatingCommentBtn.value = null;
}

// Y of the AddCommentCard inside the sidebar rail (unscaled coords,
// inside the pages-viewport). Mirrors React's addCommentYPosition.
const addCommentYPosition = ref<number | null>(null);

watch(
  () => props.documentBuffer,
  async (buf) => {
    if (buf) {
      sidebarAutoOpenedRef.value = false;
      await loadBuffer(buf);
      emit('update:document', getDocument());
      await emitReadyAfterSidebarStateRefresh();
    }
  }
);

watch(
  () => props.document,
  async (doc) => {
    if (doc) {
      sidebarAutoOpenedRef.value = false;
      loadParsedDocument(doc);
      await emitReadyAfterSidebarStateRefresh();
    }
  }
);

onMounted(async () => {
  tableResizeCleanup = tableResize.install();
  await nextTick();
  if (props.documentBuffer) {
    sidebarAutoOpenedRef.value = false;
    await loadBuffer(props.documentBuffer);
    emit('update:document', getDocument());
    await emitReadyAfterSidebarStateRefresh();
  } else if (props.document) {
    sidebarAutoOpenedRef.value = false;
    loadParsedDocument(props.document);
    await emitReadyAfterSidebarStateRefresh();
  }
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

function handleMenuTableInsert(rows: number, cols: number) {
  const view = editorView.value;
  if (!view) return;
  const insertCmd = getCommands()['insertTable'];
  if (!insertCmd) return;
  insertCmd(rows, cols)(view.state, (tr: any) => view.dispatch(tr), view);
  view.focus();
}

// =========================================================================
// Page setup
// =========================================================================

// Same shape as currentSectionProps (above); kept as an alias because
// PageSetupDialog historically takes the raw `finalSectionProperties`
// without the sections[0] fallback.
const currentSectionProperties = currentSectionProps;


// =========================================================================
// Document outline
// =========================================================================


// =========================================================================
// Comments & tracked changes sidebar
// =========================================================================

// Tracks whether we've already auto-opened the sidebar for the loaded
// document — prevents the sidebar from snapping back open every time the
// user closes it after editing a comment. Reset on document load.
const sidebarAutoOpenedRef = ref(false);

function extractCommentsAndChanges() {
  const doc = getDocument();
  const view = editorView.value;
  if (!doc || !view) return;

  // Comments live on `package.document.comments` (DocumentBody), not on
  // the package root — wrong path here was the reason the Vue sidebar
  // always showed "No comments or changes". Cloning is required so the
  // shallowRef reactivity fires.
  comments.value = [...(doc.package?.document?.comments ?? [])];

  // Same merge/replacement logic React uses, lifted to core so both
  // adapters share one implementation.
  trackedChanges.value = extractTrackedChanges(view.state).entries;

  // Auto-open the sidebar on first load if the document carries comments
  // or tracked changes.
  if (
    !sidebarAutoOpenedRef.value &&
    (comments.value.length > 0 || trackedChanges.value.length > 0)
  ) {
    showSidebar.value = true;
    sidebarAutoOpenedRef.value = true;
  }
}

function handleAddComment(text: string) {
  const doc = getDocument();
  const view = editorView.value;
  if (!doc?.package) return;
  if (!doc.package.document.comments) doc.package.document.comments = [];

  const maxId = doc.package.document.comments.reduce((max, c) => Math.max(max, c.id), 0);
  const newId = maxId + 1;
  const newComment: Comment = {
    id: newId,
    author: 'User',
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        properties: {},
        content: [{ type: 'run', properties: {}, content: [{ type: 'text', text }] }],
      },
    ] as any,
  };
  doc.package.document.comments.push(newComment);
  comments.value = [...doc.package.document.comments];

  // Replace the pending (-1) comment mark with the real id over
  // the saved range so the layout-painter writes the correct
  // [data-comment-id="N"]. Mirrors React's pendingMark +
  // commentSelectionRange swap-on-submit flow.
  const range = pendingCommentRange.value;
  if (view && range && range.from !== range.to) {
    const commentMark = view.state.schema.marks.comment;
    if (commentMark) {
      // Strip the pending -1 mark first so the new id replaces it.
      let tr = view.state.tr.removeMark(range.from, range.to, commentMark);
      tr = tr.addMark(range.from, range.to, commentMark.create({ commentId: newId }));
      view.dispatch(tr);
    }
  }
  pendingCommentRange.value = null;
  addCommentYPosition.value = null;
  isAddingComment.value = false;
  emit('change', doc);
}

function handleCancelAddComment() {
  // Strip the pending -1 mark so the yellow highlight clears when
  // the user cancels.
  const view = editorView.value;
  const range = pendingCommentRange.value;
  if (view && range && range.from !== range.to) {
    const commentMark = view.state.schema.marks.comment;
    if (commentMark) {
      view.dispatch(view.state.tr.removeMark(range.from, range.to, commentMark));
    }
  }
  pendingCommentRange.value = null;
  addCommentYPosition.value = null;
  isAddingComment.value = false;
}

// useKeyboardShortcuts owns its own window keydown listener lifecycle.
// usePagesPointer owns its own window mousemove/mouseup + viewport scroll
// listener lifecycle and table-insert timer cleanup.

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
.docx-editor-vue {
  width: 100%;
}
/* React TitleBar (packages/react/src/components/TitleBar.tsx:333):
   `flex items-stretch bg-white pt-2 pb-1`
   - left col:    `flex items-center flex-shrink-0 pl-3 pr-1`
   - center col:  `flex flex-col justify-center flex-1 min-w-0 py-1`
       top row:   `flex items-center gap-2 px-1`
       menu row:  `flex items-center px-1`
   - right col:   `flex items-center flex-shrink-0 px-3`
*/
/* Wraps title-bar + Toolbar so the white background and the
   subtle drop shadow apply to the whole toolbar block as a unit
   (mirrors React EditorToolbar.tsx:50 `bg-white shadow-sm
   flex-shrink-0`). Without this the doc-bg gray bled between the
   title bar and the toolbar, and there was no visual separation
   between the toolbar and the page area below. */
.docx-editor-vue__toolbar-shell {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #fff;
  /* Tailwind shadow-sm: `0 1px 2px 0 rgb(0 0 0 / 0.05)` */
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}
.docx-editor-vue__title-bar {
  display: flex;
  align-items: stretch;
  background: #fff;
  padding: 8px 0 4px;
  width: 100%;
  font-family:
    'Google Sans Text',
    system-ui,
    -apple-system,
    sans-serif;
}
.docx-editor-vue__title-bar-left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 4px 0 12px;
}
.docx-editor-vue__title-bar-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  padding: 0 12px;
}
.docx-editor-vue__title-bar-center {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  min-width: 0;
  padding: 4px 0;
}
.docx-editor-vue__title-bar-center > * {
  padding: 0 4px;
}
.docx-editor-vue__title-bar-center .basic-toolbar {
  width: auto;
}
/* Editor scroll container — doc-bg paints the strip between toolbar and
   page. */
.docx-editor-vue__editor-scroll {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--doc-bg, #f8f9fa);
  overflow: hidden;
}
/* Sticky ruler row that stays at the top while the page scrolls. */
.docx-editor-vue__ruler-row {
  display: flex;
  justify-content: center;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 9;
  padding: 4px 20px;
  background: var(--doc-bg, #f8f9fa);
}
.docx-editor-vue__editor-area {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  position: relative; /* anchors the absolutely-positioned vertical ruler */
}
/* Outline toggle — small circular button at the top-left of the
   editor area. `top: 24px` aligns with the page's top edge (the
   pages-viewport's padding-top from `paintPages`); `left: 48px`
   matches React's `OUTLINE_BUTTON_LEFT_OFFSET`. */
.docx-editor-vue__outline-toggle {
  position: absolute;
  top: 24px;
  left: 48px;
  z-index: 50;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #444746;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.docx-editor-vue__outline-toggle:hover {
  background: rgba(60, 64, 67, 0.08);
}
/* Vertical ruler overlays the left edge of the page area instead of
   eating a flex slot — keeping it in flow shifted the page 20px right
   and broke horizontal-ruler/page alignment. Mirrors React's
   `position: absolute, left: 0, paddingTop: 48` placement (24px
   viewport pad + 24px pages-container pad = 48px to align with the
   first page's top edge). */
.docx-editor-vue__vertical-ruler {
  position: absolute;
  left: 0;
  top: 48px;
  z-index: 30;
  pointer-events: auto;
}
.docx-editor-vue__pages-viewport {
  flex: 1;
  overflow-y: auto;
  /* Reserve scrollbar gutter on both sides so the page stays centered
     whether the scrollbar is currently visible or not — without this,
     the page nudges horizontally when content grows past one screen
     and the centered horizontal ruler ends up offset relative to the
     page on first paint. `both-edges` keeps the centering symmetric. */
  scrollbar-gutter: stable both-edges;
  /* Breathing room under the last page so it isn't flush against the
     scroll bottom. */
  padding-bottom: 24px;
  background: var(--doc-bg, #f8f9fa);
  cursor: text;
  position: relative;
}
.docx-editor-vue__pages {
  position: relative;
}

/* Floating "Add comment" button — appears next to the page's right
   edge whenever the user has a non-empty selection. */
.docx-editor-vue__floating-comment {
  position: absolute;
  transform: translate(-50%, -50%);
  z-index: 50;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid rgba(26, 115, 232, 0.3);
  background: #fff;
  color: #1a73e8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(60, 64, 67, 0.2);
  transition:
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}
.docx-editor-vue__floating-comment:hover {
  background: rgba(26, 115, 232, 0.08);
  box-shadow: 0 1px 4px rgba(26, 115, 232, 0.3);
}

/* Table quick-action insert button. */
.docx-editor-vue__table-insert-btn {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid #dadce0;
  background: #f8f9fa;
  color: #5f6368;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 200;
  padding: 0;
}
.docx-editor-vue__table-insert-btn:hover {
  background: #e8eaed;
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
