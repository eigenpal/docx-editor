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
            @comment-resolve="handleCommentResolve"
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
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import Toolbar from './Toolbar.vue';
import FindReplaceDialog from './dialogs/FindReplaceDialog.vue';
import TableToolbar from './ui/TableToolbar.vue';
import InsertImageDialog from './dialogs/InsertImageDialog.vue';
import HyperlinkDialog from './dialogs/HyperlinkDialog.vue';
import InsertSymbolDialog from './dialogs/InsertSymbolDialog.vue';
import DecorationLayer from './DecorationLayer.vue';
import ImageSelectionOverlay from './ImageSelectionOverlay.vue';
import type { ImageSelectionInfo } from './ImageSelectionOverlay.vue';
import ImagePropertiesDialog from './dialogs/ImagePropertiesDialog.vue';
import PageSetupDialog from './dialogs/PageSetupDialog.vue';
import DocumentOutline from './DocumentOutline.vue';
import KeyboardShortcutsDialog from './dialogs/KeyboardShortcutsDialog.vue';
import TextContextMenu from './TextContextMenu.vue';
import ImageContextMenu, { type ImageContextMenuState } from './ImageContextMenu.vue';
import HyperlinkPopup, { type HyperlinkPopupData } from './ui/HyperlinkPopup.vue';
import {
  detectTableInsertHover,
  TABLE_INSERT_HIDE_DELAY_MS,
} from '@eigenpal/docx-editor-core/layout-bridge/tableInsertHover';
import UnifiedSidebar from './UnifiedSidebar.vue';
import CommentMarginMarkers from './CommentMarginMarkers.vue';
import MaterialSymbol from './ui/MaterialSymbol.vue';
import PageIndicator from './PageIndicator.vue';
import InlineHeaderFooterEditor from './InlineHeaderFooterEditor.vue';
import type { HeaderFooter, Paragraph, Table } from '@eigenpal/docx-editor-core/types/content';
import type { EditorMode } from '../editor-mode';
import MenuBar from './MenuBar.vue';
import DocumentName from './DocumentName.vue';
import HorizontalRuler from './ui/HorizontalRuler.vue';
import VerticalRuler from './ui/VerticalRuler.vue';
import type { TrackedChangeEntry } from './sidebar/sidebarUtils';
import { useDocxEditor } from '../composables/useDocxEditor';
import { useZoom } from '../composables/useZoom';
import { useTableResize } from '../composables/useTableResize';
import { TextSelection, NodeSelection } from 'prosemirror-state';
import type { DocxEditorRef } from '../editor-ref';
import type { EditorView } from 'prosemirror-view';
import { findPageIndexContainingPmPos } from '@eigenpal/docx-editor-core/layout-engine';
import type { Document, SectionProperties } from '@eigenpal/docx-editor-core/types/document';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import { collectHeadings } from '@eigenpal/docx-editor-core/utils/headingCollector';
import type { HeadingInfo } from '@eigenpal/docx-editor-core/utils/headingCollector';
import { resolveDomPosition } from '@eigenpal/docx-editor-core/layout-bridge/resolveDomPosition';
import { collectBodySpans } from '@eigenpal/docx-editor-core/layout-bridge';
import {
  readSelectionGeometry,
  getCaretPositionFromDom,
} from '@eigenpal/docx-editor-core/layout-bridge/resolveDomPosition';
import { findWordBoundaries } from '@eigenpal/docx-editor-core/utils/textSelection';
import { readDocxFileFromInput } from '@eigenpal/docx-editor-core/utils';
import {
  captureInlinePositionEmu,
  findImageElement,
  toolbarValueToLayoutTarget,
} from '@eigenpal/docx-editor-core/layout-painter';
import { createTranslator, provideLocale } from '../i18n';
import { Z_INDEX } from '../styles/zIndex';
import { pointsToHalfPoints, twipsToPixels } from '@eigenpal/docx-editor-core/utils/units';
import { extractTrackedChanges } from '@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges';
import { openReportIssue } from '@eigenpal/docx-editor-core/utils/reportIssue';
import { mapHexToHighlightName } from '@eigenpal/docx-editor-core/utils/highlightColors';
import { insertPageBreak } from '@eigenpal/docx-editor-core/prosemirror/commands/pageBreak';
import {
  applyStyle,
  setIndentLeft,
  setIndentRight,
  setIndentFirstLine,
  removeTabMark,
} from '@eigenpal/docx-editor-core/prosemirror/commands/paragraph';
import { createStyleResolver } from '@eigenpal/docx-editor-core/prosemirror/styles';
import {
  clearFormatting,
  findHyperlinkRangeAt,
} from '@eigenpal/docx-editor-core/prosemirror/commands/formatting';
import { acceptChange, rejectChange } from '@eigenpal/docx-editor-core/prosemirror/commands';
import { getTableContext } from '@eigenpal/docx-editor-core/prosemirror/extensions/nodes/TableExtension';
import type { ImageLayoutTarget } from '@eigenpal/docx-editor-core/prosemirror/commands';
import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';
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
function handleEditorScrollMouseDown(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target) return;
  if (
    target.closest('.paged-editor__pages') ||
    target.closest('.unified-sidebar') ||
    target.closest('.docx-comment-margin-markers')
  ) {
    return;
  }
  activeSidebarItem.value = null;
}

// Hidden file input that backs the File > Open menu action. Lets
// users open a document straight from the menu without the host
// having to wire its own picker.
const docxInputRef = ref<HTMLInputElement | null>(null);

async function handleDocxFileChange(event: Event) {
  try {
    const result = await readDocxFileFromInput(event);
    if (!result) return;
    await loadBuffer(result.buffer);
    emit('update:document', getDocument());
    emit('rename', result.name);
    await emitReadyAfterSidebarStateRefresh();
  } catch (err) {
    emit('error', err instanceof Error ? err : new Error('Failed to open document'));
  }
}

async function emitReadyAfterSidebarStateRefresh() {
  // Extract comments BEFORE emitting `ready` so host listeners that read
  // comments / tracked changes on the event see the new doc, not stale arrays.
  await nextTick();
  extractCommentsAndChanges();
  emit('ready');
}

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

function handleDocumentNameChange(name: string) {
  props.onDocumentNameChange?.(name);
  emit('rename', name);
}

function handleClearFormatting() {
  const view = editorView.value;
  if (!view) return;
  clearFormatting(view.state, view.dispatch, view);
  view.focus();
}

/**
 * File > Save in the menu bar should produce a downloadable .docx, not
 * just stash the Blob and forget. Falls back to "document.docx" when
 * the host doesn't supply a `documentName` prop.
 */
async function downloadCurrentDocument() {
  const blob = await saveBlob();
  if (!blob) return;
  const baseName = (props.documentName || '').trim() || 'document';
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.href = url;
  a.download = `${baseName.replace(/\.docx$/i, '')}.docx`;
  // The anchor never enters the DOM tree — `.click()` works without
  // appending in modern browsers, and skipping the append/remove dance
  // avoids a layout flash on tall pages.
  a.click();
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
const contextMenu = ref({
  isOpen: false,
  position: { x: 0, y: 0 },
  hasSelection: false,
  inTable: false,
  onImage: false,
  canMergeCells: false,
  canSplitCell: false,
});
// Image-specific right-click menu — shows wrap-mode options instead of the
// generic text menu when the user right-clicks a rendered image.
const imageContextMenu = ref<ImageContextMenuState | null>(null);
// Single-click on a hyperlink surfaces a popup with copy / edit /
// unlink. Cleared on selection change, escape, or click-outside.
const hyperlinkPopupData = ref<HyperlinkPopupData | null>(null);

// Table quick-action "+" button — surfaces on hover near the left
// edge (row insert) or top edge (column insert) of a layout table.
const tableInsertButton = ref<{
  type: 'row' | 'column';
  x: number;
  y: number;
  cellPmPos: number;
} | null>(null);
let tableInsertHideTimer: ReturnType<typeof setTimeout> | null = null;
function clearTableInsertTimer() {
  if (tableInsertHideTimer !== null) {
    clearTimeout(tableInsertHideTimer);
    tableInsertHideTimer = null;
  }
}
// Cut / Copy / Paste / Delete items appended below the layout choices in
// the image context menu so users don't have to flip menus to do
// clipboard work on a selected image.
const imageContextMenuTextActions = computed(() => [
  { action: 'cut', label: t('contextMenu.cut'), shortcut: t('contextMenu.cutShortcut') },
  { action: 'copy', label: t('contextMenu.copy'), shortcut: t('contextMenu.copyShortcut') },
  {
    action: 'paste',
    label: t('contextMenu.paste'),
    shortcut: t('contextMenu.pasteShortcut'),
    dividerAfter: true,
  },
  { action: 'delete', label: t('contextMenu.delete'), shortcut: t('contextMenu.deleteShortcut') },
]);
const outlineHeadings = shallowRef<HeadingInfo[]>([]);
// shallowRef so the wrapped HTMLElement isn't proxied — identity comparisons
// downstream (ImageSelectionOverlay) rely on raw element references.
const selectedImage = shallowRef<ImageSelectionInfo | null>(null);
// True while the overlay is mid-resize / move / rotate — gates the pages
// mousedown handler so an in-flight image gesture isn't clobbered by a stray
// click (mirrors React's PagedEditor.isImageInteractingRef).
const imageInteracting = ref(false);

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
    const selection = getSelectionInfo();
    selectionChangeSubscribers.forEach((listener) => listener(selection));
  },
});

function print() {
  props.onPrint?.();
  window.print();
}

function openPrintPreview() {
  print();
}

function getZoom() {
  return zoom.value;
}

function scrollToPage(pageNumber: number) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
  const viewport = pagesViewportRef.value;
  const pageEl = pagesRef.value?.querySelector<HTMLElement>(`[data-page-number="${pageNumber}"]`);
  if (!viewport || !pageEl) return;
  const viewportRect = viewport.getBoundingClientRect();
  const pageRect = pageEl.getBoundingClientRect();
  viewport.scrollTo({
    top: pageRect.top - viewportRect.top + viewport.scrollTop - 24,
    behavior: 'smooth',
  });
}

function scrollToPosition(pmPos: number) {
  if (!Number.isFinite(pmPos)) return;
  scrollVisiblePositionIntoView(pmPos);
}

async function loadDocumentBuffer(buffer: Parameters<typeof loadBuffer>[0]) {
  await loadBuffer(buffer);
  await emitReadyAfterSidebarStateRefresh();
}

function loadDocument(doc: Document) {
  loadParsedDocument(doc);
  emit('update:document', doc);
  void emitReadyAfterSidebarStateRefresh();
}

async function save(): Promise<ArrayBuffer | null> {
  const blob = await saveBlob();
  return blob ? blob.arrayBuffer() : null;
}

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

function getEditorRef() {
  if (!editorView.value) return null;
  return {
    getDocument,
    getView: () => editorView.value,
    getState: () => editorView.value?.state ?? null,
  };
}

function getTotalPages(): number {
  return layout.value?.pages.length ?? 0;
}

function getCurrentPage(): number {
  const currentLayout = layout.value;
  const view = editorView.value;
  if (!currentLayout || !view) return 0;
  const pageIndex = findPageIndexContainingPmPos(currentLayout, view.state.selection.from);
  return pageIndex == null ? 0 : pageIndex + 1;
}

function findParaIdRange(
  doc: ProseMirrorNode,
  paraId: string
): { from: number; to: number } | null {
  if (!paraId.trim()) return null;
  let result: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (result) return false;
    if (node.isTextblock && node.attrs?.paraId === paraId) {
      result = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return result;
}

function getVanillaNodeText(node: ProseMirrorNode): string {
  const parts: string[] = [];
  node.descendants((child) => {
    if (!child.isText || !child.text) return true;
    if (child.marks.some((mark) => mark.type.name === 'insertion')) return false;
    parts.push(child.text);
    return true;
  });
  return parts.join('');
}

function getVanillaTextBetween(doc: ProseMirrorNode, from: number, to: number): string {
  if (from >= to) return '';
  const parts: string[] = [];
  doc.nodesBetween(from, to, (child, pos) => {
    if (!child.isText || !child.text) return;
    if (child.marks.some((mark) => mark.type.name === 'insertion')) return;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + child.text.length);
    if (start < end) parts.push(child.text.slice(start - pos, end - pos));
  });
  return parts.join('');
}

function findTextInPmParagraph(
  doc: ProseMirrorNode,
  paragraphFrom: number,
  paragraphTo: number,
  searchText: string
): { from: number; to: number } | null {
  if (!searchText) return null;
  let fullText = '';
  const textPositions: { pos: number; len: number }[] = [];

  doc.nodesBetween(paragraphFrom, paragraphTo, (node, pos) => {
    if (!node.isText || !node.text) return;
    if (node.marks.some((mark) => mark.type.name === 'insertion')) return;
    textPositions.push({ pos, len: node.text.length });
    fullText += node.text;
  });

  const firstMatch = fullText.indexOf(searchText);
  if (firstMatch === -1) return null;
  if (fullText.indexOf(searchText, firstMatch + 1) !== -1) return null;

  let charOffset = 0;
  let fromPos = paragraphFrom;
  let toPos = paragraphFrom;
  for (const textPos of textPositions) {
    const segmentEnd = charOffset + textPos.len;
    if (charOffset <= firstMatch && firstMatch < segmentEnd) {
      fromPos = textPos.pos + (firstMatch - charOffset);
    }
    if (
      charOffset <= firstMatch + searchText.length &&
      firstMatch + searchText.length <= segmentEnd
    ) {
      toPos = textPos.pos + (firstMatch + searchText.length - charOffset);
      break;
    }
    charOffset = segmentEnd;
  }

  return { from: fromPos, to: toPos };
}

function createComment(text: string, author: string, parentId?: number): Comment {
  const doc = getDocument();
  const commentsList = doc?.package?.document?.comments ?? [];
  const maxId = commentsList.reduce((max, comment) => Math.max(max, comment.id), 0);
  return {
    id: maxId + 1,
    author,
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        properties: {},
        content: [{ type: 'run', properties: {}, content: [{ type: 'text', text }] }],
      },
    ] as any,
    ...(parentId != null ? { parentId } : {}),
  };
}

function addComment(options: {
  paraId: string;
  text: string;
  author: string;
  search?: string;
}): number | null {
  const doc = getDocument();
  const view = editorView.value;
  if (!doc?.package?.document || !view) return null;
  if (!doc.package.document.comments) doc.package.document.comments = [];
  const commentMark = view.state.schema.marks.comment;
  if (!commentMark) return null;

  const range = findParaIdRange(view.state.doc, options.paraId);
  if (!range) return null;

  let from = range.from + 1;
  let to = range.to - 1;
  if (options.search) {
    const textRange = findTextInPmParagraph(view.state.doc, range.from, range.to, options.search);
    if (!textRange) return null;
    from = textRange.from;
    to = textRange.to;
  }
  if (from >= to) return null;

  const comment = createComment(options.text, options.author);
  doc.package.document.comments.push(comment);
  comments.value = [...doc.package.document.comments];
  view.dispatch(view.state.tr.addMark(from, to, commentMark.create({ commentId: comment.id })));
  showSidebar.value = true;
  emit('change', doc);
  contentChangeSubscribers.forEach((listener) => listener(doc));
  return comment.id;
}

function replyToComment(commentId: number, text: string, author: string): number | null {
  const doc = getDocument();
  if (!doc?.package?.document?.comments) return null;
  if (!doc.package.document.comments.some((comment) => comment.id === commentId)) return null;
  const reply = createComment(text, author, commentId);
  doc.package.document.comments.push(reply);
  comments.value = [...doc.package.document.comments];
  emit('change', doc);
  contentChangeSubscribers.forEach((listener) => listener(doc));
  return reply.id;
}

function resolveComment(commentId: number): void {
  const doc = getDocument();
  if (!doc?.package?.document?.comments) return;
  const comment = doc.package.document.comments.find((item) => item.id === commentId);
  if (!comment) return;
  comment.done = true;
  comments.value = [...doc.package.document.comments];
  emit('change', doc);
  contentChangeSubscribers.forEach((listener) => listener(doc));
}

function proposeChange(options: {
  paraId: string;
  search: string;
  replaceWith: string;
  author: string;
}): boolean {
  const view = editorView.value;
  if (!view) return false;
  const { schema } = view.state;
  if (!schema.marks.deletion || !schema.marks.insertion) return false;
  const range = findParaIdRange(view.state.doc, options.paraId);
  if (!range) return false;

  const isInsertion = options.search === '';
  const isDeletion = options.replaceWith === '';
  if (isInsertion && isDeletion) return false;

  let textFrom: number;
  let textTo: number;
  if (isInsertion) {
    textFrom = range.to - 1;
    textTo = range.to - 1;
  } else {
    const textRange = findTextInPmParagraph(view.state.doc, range.from, range.to, options.search);
    if (!textRange) return false;
    textFrom = textRange.from;
    textTo = textRange.to;
  }

  let overlapsTrackedChange = false;
  if (textFrom < textTo) {
    view.state.doc.nodesBetween(textFrom, textTo, (node) => {
      for (const mark of node.marks) {
        if (mark.type === schema.marks.insertion || mark.type === schema.marks.deletion) {
          overlapsTrackedChange = true;
          return false;
        }
      }
      return true;
    });
  }
  if (overlapsTrackedChange) return false;

  const revisionId = Math.max(0, ...trackedChanges.value.map((change) => change.revisionId)) + 1;
  const date = new Date().toISOString();
  const deletionMark = schema.marks.deletion.create({ revisionId, author: options.author, date });
  const insertionMark = schema.marks.insertion.create({ revisionId, author: options.author, date });

  let tr = view.state.tr;
  if (!isInsertion) tr = tr.addMark(textFrom, textTo, deletionMark);
  if (!isDeletion) tr = tr.insert(textTo, schema.text(options.replaceWith, [insertionMark]));
  view.dispatch(tr);
  extractCommentsAndChanges();
  showSidebar.value = true;
  return true;
}

function scrollToParaId(paraId: string): boolean {
  const view = editorView.value;
  if (!view) return false;
  const range = findParaIdRange(view.state.doc, paraId);
  if (!range) return false;
  scrollVisiblePositionIntoView(range.from + 1);
  return true;
}

function findInDocument(
  query: string,
  opts?: { caseSensitive?: boolean; limit?: number }
): Array<{ paraId: string; match: string; before: string; after: string }> {
  const view = editorView.value;
  if (!view || !query) return [];
  const caseSensitive = opts?.caseSensitive ?? false;
  const limit = opts?.limit ?? 20;
  const needle = caseSensitive ? query : query.toLowerCase();
  const results: Array<{ paraId: string; match: string; before: string; after: string }> = [];

  view.state.doc.descendants((node) => {
    if (results.length >= limit) return false;
    if (!node.isTextblock) return true;
    const paraId = node.attrs?.paraId as string | undefined;
    if (!paraId) return false;
    const text = getVanillaNodeText(node);
    const haystack = caseSensitive ? text : text.toLowerCase();
    const at = haystack.indexOf(needle);
    if (at === -1 || haystack.indexOf(needle, at + 1) !== -1) return false;
    const context = 40;
    results.push({
      paraId,
      match: text.slice(at, at + query.length),
      before: text.slice(Math.max(0, at - context), at),
      after: text.slice(at + query.length, at + query.length + context),
    });
    return false;
  });

  return results;
}

function getSelectionInfo() {
  const view = editorView.value;
  if (!view) return null;
  const { selection, doc } = view.state;
  const $from = selection.$from;
  let depth = $from.depth;
  while (depth > 0 && !$from.node(depth).isTextblock) depth--;
  const para = depth > 0 ? $from.node(depth) : null;
  if (!para) return null;
  const paraId = (para.attrs?.paraId as string | undefined) ?? null;
  const paraStart = $from.start(depth);
  const paraEnd = paraStart + para.content.size;
  const before = getVanillaTextBetween(doc, paraStart, selection.from);
  const selectedText = getVanillaTextBetween(doc, selection.from, selection.to);
  const after = getVanillaTextBetween(doc, selection.to, paraEnd);
  return { paraId, selectedText, paragraphText: before + selectedText + after, before, after };
}

function getComments() {
  return comments.value;
}

function applyFormatting(options: {
  paraId: string;
  search?: string;
  marks: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean | { style?: string };
    strike?: boolean;
    color?: { rgb?: string; themeColor?: string };
    highlight?: string;
    fontSize?: number;
    fontFamily?: { ascii?: string; hAnsi?: string };
  };
}): boolean {
  const view = editorView.value;
  if (!view) return false;
  const range = findParaIdRange(view.state.doc, options.paraId);
  if (!range) return false;

  let from = range.from + 1;
  let to = range.to - 1;
  if (options.search) {
    const textRange = findTextInPmParagraph(view.state.doc, range.from, range.to, options.search);
    if (!textRange) return false;
    from = textRange.from;
    to = textRange.to;
  }
  if (from >= to) return true;

  const { schema } = view.state;
  const marks = options.marks;
  let tr = view.state.tr;

  if (marks.bold !== undefined && schema.marks.bold) {
    tr = marks.bold
      ? tr.addMark(from, to, schema.marks.bold.create())
      : tr.removeMark(from, to, schema.marks.bold);
  }
  if (marks.italic !== undefined && schema.marks.italic) {
    tr = marks.italic
      ? tr.addMark(from, to, schema.marks.italic.create())
      : tr.removeMark(from, to, schema.marks.italic);
  }
  if (marks.underline !== undefined && schema.marks.underline) {
    if (marks.underline) {
      const style = typeof marks.underline === 'object' ? marks.underline.style : undefined;
      tr = tr.addMark(from, to, schema.marks.underline.create({ style: style ?? 'single' }));
    } else {
      tr = tr.removeMark(from, to, schema.marks.underline);
    }
  }
  if (marks.strike !== undefined && schema.marks.strike) {
    tr = marks.strike
      ? tr.addMark(from, to, schema.marks.strike.create())
      : tr.removeMark(from, to, schema.marks.strike);
  }
  if (marks.color !== undefined && schema.marks.textColor) {
    if (marks.color && (marks.color.rgb || marks.color.themeColor)) {
      tr = tr.addMark(
        from,
        to,
        schema.marks.textColor.create({
          rgb: marks.color.rgb ?? null,
          themeColor: marks.color.themeColor ?? null,
        })
      );
    } else {
      tr = tr.removeMark(from, to, schema.marks.textColor);
    }
  }
  if (marks.highlight !== undefined && schema.marks.highlight) {
    if (marks.highlight) {
      tr = tr.addMark(
        from,
        to,
        schema.marks.highlight.create({
          color: mapHexToHighlightName(marks.highlight) || marks.highlight,
        })
      );
    } else {
      tr = tr.removeMark(from, to, schema.marks.highlight);
    }
  }
  if (marks.fontSize !== undefined && schema.marks.fontSize) {
    tr =
      marks.fontSize > 0
        ? tr.addMark(
            from,
            to,
            schema.marks.fontSize.create({ size: pointsToHalfPoints(marks.fontSize) })
          )
        : tr.removeMark(from, to, schema.marks.fontSize);
  }
  if (marks.fontFamily !== undefined && schema.marks.fontFamily) {
    if (marks.fontFamily && (marks.fontFamily.ascii || marks.fontFamily.hAnsi)) {
      tr = tr.addMark(
        from,
        to,
        schema.marks.fontFamily.create({
          ascii: marks.fontFamily.ascii ?? null,
          hAnsi: marks.fontFamily.hAnsi ?? marks.fontFamily.ascii ?? null,
        })
      );
    } else {
      tr = tr.removeMark(from, to, schema.marks.fontFamily);
    }
  }

  view.dispatch(tr);
  return true;
}

function setParagraphStyle(options: { paraId: string; styleId: string }): boolean {
  const view = editorView.value;
  if (!view) return false;
  const range = findParaIdRange(view.state.doc, options.paraId);
  if (!range) return false;

  const doc = getDocument();
  const styleResolver = doc?.package?.styles ? createStyleResolver(doc.package.styles) : null;
  if (styleResolver && !styleResolver.hasParagraphStyle(options.styleId)) return false;

  const $from = view.state.doc.resolve(range.from + 1);
  const $to = view.state.doc.resolve(range.to - 1);
  const stateWithSelection = view.state.apply(
    view.state.tr.setSelection(TextSelection.between($from, $to))
  );
  const command = styleResolver
    ? (() => {
        const resolved = styleResolver.resolveParagraphStyle(options.styleId);
        return applyStyle(options.styleId, {
          paragraphFormatting: resolved.paragraphFormatting,
          runFormatting: resolved.runFormatting,
        });
      })()
    : applyStyle(options.styleId);

  let didApply = false;
  command(stateWithSelection, (transaction: any) => {
    didApply = true;
    transaction.setSelection(view.state.selection.map(transaction.doc, transaction.mapping));
    view.dispatch(transaction);
  });
  return didApply;
}

function getPageContent(pageNumber: number) {
  const currentLayout = layout.value;
  const view = editorView.value;
  if (!currentLayout || !view) return null;
  const page = currentLayout.pages[pageNumber - 1];
  if (!page) return null;

  const seen = new Set<string>();
  const paragraphs: Array<{ paraId: string; text: string; styleId?: string }> = [];
  for (const fragment of page.fragments) {
    if (fragment.kind !== 'paragraph') continue;
    const docFrom = fragment.docFrom;
    if (docFrom == null) continue;
    const node = view.state.doc.nodeAt(docFrom);
    if (!node || !node.isTextblock) continue;
    const paraId = node.attrs?.paraId as string | undefined;
    if (!paraId || seen.has(paraId)) continue;
    seen.add(paraId);
    paragraphs.push({
      paraId,
      text: getVanillaNodeText(node),
      styleId: (node.attrs?.styleId as string | undefined) ?? undefined,
    });
  }

  const text = paragraphs.map((paragraph) => `[${paragraph.paraId}] ${paragraph.text}`).join('\n');
  return { pageNumber, text, paragraphs };
}

function onContentChange(listener: (document: unknown) => void): () => void {
  contentChangeSubscribers.add(listener);
  return () => contentChangeSubscribers.delete(listener);
}

function onSelectionChange(listener: (selection: unknown) => void): () => void {
  selectionChangeSubscribers.add(listener);
  return () => selectionChangeSubscribers.delete(listener);
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

// Inline header/footer editor state (#388 port). When the user
// double-clicks a header or footer region, capture which side they hit,
// which HF (default vs first-page), and the bounding rect of the clicked
// region so the floating editor can overlay it. Save flow updates the
// matching pkg.headers/footers Map entry and re-runs layout.
const hfEdit = ref<{
  position: 'header' | 'footer';
  rId: string | null;
  headerFooter: HeaderFooter | null;
  targetRect: { top: number; left: number; width: number; height: number } | null;
} | null>(null);

/**
 * Show / hide the "+" insert button as the cursor moves near a
 * table's edges. Hide is debounced through `TABLE_INSERT_HIDE_DELAY_MS`
 * so transient gaps between cells don't make the button flicker.
 */
function handlePagesMouseMove(event: MouseEvent) {
  if (readOnly.value) return;
  // Skip the hit-test during text drag-selects so the (+) doesn't
  // pop in mid-selection when the drag path crosses a table edge.
  if (isDragging) return;
  const pagesEl = pagesRef.value;
  if (!pagesEl) return;
  const viewportEl = pagesViewportRef.value;
  if (!viewportEl) return;

  const hit = detectTableInsertHover({
    mouseX: event.clientX,
    mouseY: event.clientY,
    pagesContainer: pagesEl,
    target: event.target as HTMLElement,
    hfEditMode: hfEdit.value?.position ?? null,
  });

  if (!hit) {
    if (tableInsertHideTimer === null) {
      tableInsertHideTimer = setTimeout(() => {
        tableInsertButton.value = null;
        tableInsertHideTimer = null;
      }, TABLE_INSERT_HIDE_DELAY_MS);
    }
    return;
  }

  const viewportRect = viewportEl.getBoundingClientRect();
  tableInsertButton.value = {
    type: hit.type,
    x: hit.clientX - viewportRect.left,
    y: hit.clientY - viewportRect.top,
    cellPmPos: hit.cellPmPos,
  };
  clearTableInsertTimer();
}

/**
 * Insert a row below / column to the right of the target cell. The
 * core `addRowBelow` / `addColumnRight` commands read the current
 * PM selection to know which cell to extend, so we plant a caret
 * inside the hovered cell first.
 */
function handleTableInsertClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const btn = tableInsertButton.value;
  const view = editorView.value;
  if (!btn || !view) return;
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, btn.cellPmPos + 1));
  view.dispatch(tr);
  const cmds = getCommands();
  const cmd = btn.type === 'row' ? cmds.addRowBelow() : cmds.addColumnRight();
  cmd(view.state, (t: any) => view.dispatch(t), view);
  tableInsertButton.value = null;
  view.focus();
}

/**
 * Single-click on a hyperlink → surface the popup or navigate internal
 * bookmarks. Browser default navigation stays suppressed so drag-selects
 * ending on links do not unexpectedly leave the document.
 */
function handlePagesClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement | null)?.closest(
    'a[href]'
  ) as HTMLAnchorElement | null;
  if (!anchor) return;
  // Suppress the browser's default navigation for every click that
  // lands on an anchor — including drag-selects that end on one.
  // Without this, ending a selection inside a link still opens it.
  event.preventDefault();
  const href = anchor.getAttribute('href') || '';
  if (!href) return;
  if (href.startsWith('#')) {
    const bookmarkName = href.slice(1);
    if (bookmarkName) navigateToBookmark(bookmarkName);
    return;
  }
  // Drag-to-select past a link should suppress the popup but still
  // keep navigation blocked above.
  const view = editorView.value;
  const hasRangeSelection = view && view.state.selection.from !== view.state.selection.to;
  if (hasRangeSelection) return;
  hyperlinkPopupData.value = {
    href,
    displayText: anchor.textContent || '',
    tooltip: anchor.getAttribute('title') || undefined,
    anchorRect: anchor.getBoundingClientRect(),
  };
}

function navigateToBookmark(bookmarkName: string) {
  const view = editorView.value;
  if (!view) return;
  let targetPos: number | null = null;
  view.state.doc.descendants((node, pos) => {
    if (targetPos !== null) return false;
    const bookmarks = node.attrs?.bookmarks as Array<{ name?: string }> | undefined;
    if (bookmarks?.some((b) => b.name === bookmarkName)) {
      targetPos = pos;
      return false;
    }
    return true;
  });
  if (targetPos === null) return;
  scrollVisiblePositionIntoView(targetPos);
  try {
    setPmSelection(Math.min(targetPos + 1, view.state.doc.content.size));
  } catch {
    // Bookmark target may be a non-text selectable position; fall back to the
    // start position so the click still moves the editor near the target.
    setPmSelection(targetPos);
  }
}

function scrollVisiblePositionIntoView(pmPos: number) {
  const pagesContainer = pagesRef.value;
  const viewport = pagesViewportRef.value;
  if (!pagesContainer || !viewport) return;
  let targetEl: HTMLElement | null = null;
  for (const el of collectBodySpans(pagesContainer)) {
    const start = Number(el.dataset.docFrom);
    const end = Number(el.dataset.docTo);
    if (Number.isFinite(start) && Number.isFinite(end) && pmPos >= start && pmPos <= end) {
      targetEl = el;
      break;
    }
  }
  if (!targetEl) {
    targetEl = pagesContainer.querySelector<HTMLElement>(`[data-doc-from="${pmPos}"]`);
  }
  if (!targetEl) return;
  const viewportRect = viewport.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  viewport.scrollTo({
    top: targetRect.top - viewportRect.top + viewport.scrollTop - 48,
    behavior: 'smooth',
  });
}

function handleHyperlinkPopupNavigate(href: string) {
  window.open(href, '_blank', 'noopener,noreferrer');
  hyperlinkPopupData.value = null;
}

function handleHyperlinkPopupEdit(displayText: string, href: string) {
  const view = editorView.value;
  if (!view) return;
  const hit = findHyperlinkRangeAt(view.state);
  if (!hit) {
    hyperlinkPopupData.value = null;
    return;
  }
  const hlType = view.state.schema.marks.hyperlink;
  const { $from } = view.state.selection;
  const newMark = hlType.create({ href, tooltip: hit.mark.attrs.tooltip });
  const otherMarks = $from.marks().filter((m) => m.type !== hlType);
  const textNode = view.state.schema.text(displayText, [...otherMarks, newMark]);
  const tr = view.state.tr.replaceWith(hit.start, hit.end, textNode);
  view.dispatch(tr.scrollIntoView());
  hyperlinkPopupData.value = null;
  view.focus();
}

function handleHyperlinkPopupRemove() {
  const view = editorView.value;
  if (!view) return;
  const hit = findHyperlinkRangeAt(view.state, hyperlinkPopupData.value?.href);
  if (!hit) {
    hyperlinkPopupData.value = null;
    return;
  }
  const hlType = view.state.schema.marks.hyperlink;
  const tr = view.state.tr.removeMark(hit.start, hit.end, hlType);
  view.dispatch(tr.scrollIntoView());
  hyperlinkPopupData.value = null;
  view.focus();
}

function handlePagesDoubleClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const headerEl = target.closest('.layout-page-header') as HTMLElement | null;
  const footerEl = target.closest('.layout-page-footer') as HTMLElement | null;
  const hfEl = headerEl ?? footerEl;
  if (!hfEl) return;

  const position: 'header' | 'footer' = headerEl ? 'header' : 'footer';
  const doc = getDocument();
  if (!doc?.package) return;

  // Resolve the HF for the current section. Mirrors the lookup in
  // useDocxEditor.runLayoutPipeline so what the user sees on page is
  // what they get to edit.
  const sp =
    doc.package.document?.sections?.[0]?.properties ??
    doc.package.document?.finalSectionProperties ??
    null;
  const refs = position === 'header' ? sp?.headerReferences : sp?.footerReferences;
  const map = position === 'header' ? doc.package.headers : doc.package.footers;
  if (!refs || !map) return;
  // Default ref takes priority; fall back to `first` if the doc only ships first.
  const refEntry = refs.find((r) => r.type === 'default') ?? refs.find((r) => r.type === 'first');
  const rId = refEntry?.rId ?? null;
  const hf = rId ? (map.get(rId) ?? null) : null;

  // Bounding rect relative to the pages-viewport. zoom is applied via
  // CSS transform on the viewport, so use the unscaled element coords.
  const viewport = pagesViewportRef.value;
  if (!viewport) return;
  const elRect = hfEl.getBoundingClientRect();
  const vpRect = viewport.getBoundingClientRect();
  const z = zoom.value || 1;
  hfEdit.value = {
    position,
    rId,
    headerFooter: hf,
    targetRect: {
      top: (elRect.top - vpRect.top + viewport.scrollTop) / z,
      left: (elRect.left - vpRect.left + viewport.scrollLeft) / z,
      width: elRect.width / z,
      height: elRect.height / z,
    },
  };
}

function handleHfSave(content: (Paragraph | Table)[]) {
  const doc = getDocument();
  const edit = hfEdit.value;
  if (!doc?.package || !edit) return;
  const map = edit.position === 'header' ? doc.package.headers : doc.package.footers;
  if (!map || !edit.rId) return;
  const existing = map.get(edit.rId);
  if (existing) {
    existing.content = content;
  }
  reLayout();
  emit('change', doc);
}

function handleHfRemove() {
  const doc = getDocument();
  const edit = hfEdit.value;
  if (!doc?.package || !edit || !edit.rId) return;
  const map = edit.position === 'header' ? doc.package.headers : doc.package.footers;
  const existing = map?.get(edit.rId);
  if (existing) {
    existing.content = [];
  }
  hfEdit.value = null;
  reLayout();
  emit('change', doc);
}

// Page indicator overlay state — mirrors React DocxEditor.tsx scrollPageInfo.
// `currentPage` is computed from scroll position against per-page heights from
// the engine layout; the indicator fades out 600ms after scrolling stops.
const scrollPageInfo = ref<{
  currentPage: number;
  totalPages: number;
  visible: boolean;
}>({ currentPage: 1, totalPages: 1, visible: false });
let scrollFadeTimer: ReturnType<typeof setTimeout> | null = null;

function handleViewportScroll() {
  const container = pagesViewportRef.value;
  const lay = layout.value;
  if (!container || !lay || lay.pages.length === 0) return;

  const scrollTop = container.scrollTop;
  const totalPages = lay.pages.length;
  const PAGE_GAP = 24; // matches DEFAULT_PAGE_GAP in useDocxEditor
  const PADDING_TOP = 24;

  const viewportCenter = scrollTop + container.clientHeight / 2;
  let accumulatedY = PADDING_TOP;
  let currentPage = 1;
  for (let i = 0; i < lay.pages.length; i++) {
    const pageHeight = lay.pages[i].size.h;
    const pageEnd = accumulatedY + pageHeight;
    if (viewportCenter < pageEnd) {
      currentPage = i + 1;
      break;
    }
    accumulatedY = pageEnd + PAGE_GAP;
    currentPage = i + 2;
  }
  currentPage = Math.min(currentPage, totalPages);

  scrollPageInfo.value = { currentPage, totalPages, visible: true };

  if (scrollFadeTimer) clearTimeout(scrollFadeTimer);
  scrollFadeTimer = setTimeout(() => {
    scrollPageInfo.value = { ...scrollPageInfo.value, visible: false };
  }, 600);
}

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

// Table resize handlers — port of React PagedEditor.tsx column/row/right-edge
// resize. tryStartResize() runs from handlePagesMouseDown; install() wires
// global mousemove/mouseup that drives the drag and commits the PM transaction.
const tableResize = useTableResize();
let tableResizeCleanup: (() => void) | null = null;

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

  // Keep `selectedImage` in sync with the PM selection: when the doc holds a
  // NodeSelection on an image (e.g. the overlay just re-selected it after a
  // resize / move / rotate that re-painted the pages), re-resolve to the fresh
  // painted element. Mirrors React's PagedEditor selection handler. A PM
  // position can carry `data-doc-from` on more than one painted element (the
  // image's wrapper plus, say, the run span beside it), so scan the matches
  // and take the one that resolves to an actual image wrapper.
  const sel = view.state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'image') {
    let imgEl: HTMLElement | null = null;
    for (const el of container.querySelectorAll<HTMLElement>(`[data-doc-from="${sel.from}"]`)) {
      const img = findImageElement(el);
      if (img) {
        imgEl = img;
        break;
      }
    }
    if (imgEl) {
      const prev = selectedImage.value;
      if (
        !prev ||
        prev.element !== imgEl ||
        prev.pmPos !== sel.from ||
        prev.width !== imgEl.offsetWidth ||
        prev.height !== imgEl.offsetHeight
      ) {
        selectedImage.value = {
          element: imgEl,
          pmPos: sel.from,
          width: imgEl.offsetWidth,
          height: imgEl.offsetHeight,
        };
      }
      return;
    }
  }

  // Skip text/caret overlay when an image is selected — ImageSelectionOverlay handles it
  if (selectedImage.value) return;

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
        width: 2px;
        height: ${caret.height}px;
        background: #000;
        pointer-events: none;
        z-index: ${Z_INDEX.selectionOverlay};
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
  const rects = readSelectionGeometry(container, from, to, overlayRect);

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
      z-index: ${Z_INDEX.selectionOverlay};
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
  // Scope to body PM spans (which carry both docFrom and docTo) so HF
  // runs in the separate PM document don't mis-resolve double-/triple-
  // click selection. Tighter than `findBodyPmAnchors` (which includes
  // bare paragraph anchors that don't have data-doc-to). Mirrors
  // React's PagedEditor selection-resolution call.
  const els = collectBodySpans(container);
  for (const el of els) {
    const start = Number(el.dataset.docFrom);
    const end = Number(el.dataset.docTo);
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
  const docFrom = Number(el.dataset.docFrom) || 0;
  const offset = pos - docFrom;
  const [start, end] = findWordBoundaries(text, offset);
  const from = docFrom + start;
  const to = docFrom + end;
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
  const docFrom = Number(paragraph.dataset.docFrom);
  const docTo = Number(paragraph.dataset.docTo);
  if (!isNaN(docFrom) && !isNaN(docTo) && docFrom < docTo) {
    setPmSelection(docFrom, docTo);
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
  const pos = resolveDomPosition(container, clientX, clientY, 1);
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

// `findImageElement` lives in
// `@eigenpal/docx-editor-core/layout-painter` so React + Vue share the
// rendered-image hit-test taxonomy (LAYOUT_IMAGE_CLASSES). Imported
// alongside the rest of the layout-painter API at the top of the file.

function handlePagesMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;
  // An image resize / move / rotate is in progress — its own document-level
  // listeners own this gesture; don't let the pages handler interfere.
  if (imageInteracting.value) return;
  const view = editorView.value;
  if (!view) return;

  // Table resize: if the user clicked a column/row/right-edge handle,
  // start the resize drag and skip text selection.
  if (!readOnly.value && tableResize.tryStartResize(event, view)) {
    return;
  }

  // Check if user clicked on an image
  const target = event.target as HTMLElement;
  const imageEl = findImageElement(target);
  if (imageEl) {
    event.preventDefault();
    event.stopPropagation();
    const docFrom = Number(imageEl.dataset.docFrom);
    if (!isNaN(docFrom)) {
      // Set ProseMirror node selection on the image
      try {
        const sel = NodeSelection.create(view.state.doc, docFrom);
        view.dispatch(view.state.tr.setSelection(sel));
      } catch {
        // Position may be invalid
      }
      selectedImage.value = {
        element: imageEl,
        pmPos: docFrom,
        width: imageEl.offsetWidth,
        height: imageEl.offsetHeight,
      };
      // Clear text caret overlay so it doesn't show alongside the image selection
      clearOverlay();
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

function handleMenuTableInsert(rows: number, cols: number) {
  const view = editorView.value;
  if (!view) return;
  const insertCmd = getCommands()['insertTable'];
  if (!insertCmd) return;
  insertCmd(rows, cols)(view.state, (tr: any) => view.dispatch(tr), view);
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

function handleHyperlinkSubmit(data: {
  url?: string;
  bookmark?: string;
  displayText: string;
  tooltip: string;
}) {
  const view = editorView.value;
  if (!view) return;
  const cmds = getCommands();
  const { empty } = view.state.selection;
  const href = data.bookmark ? `#${data.bookmark}` : data.url;
  if (!href) return;

  if (empty && data.displayText) {
    // Insert new link with text
    const cmd = cmds['insertHyperlink'];
    if (cmd) {
      const command = cmd(data.displayText, href, data.tooltip || undefined);
      command(view.state, (tr: any) => view.dispatch(tr), view);
    }
  } else {
    // Apply link to selection
    const cmd = cmds['setHyperlink'];
    if (cmd) {
      const command = cmd(href, data.tooltip || undefined);
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

// Same shape as currentSectionProps (above); kept as an alias because
// PageSetupDialog historically takes the raw `finalSectionProperties`
// without the sections[0] fallback.
const currentSectionProperties = currentSectionProps;

function handlePageSetupApply(sp: Partial<SectionProperties>) {
  const doc = getDocument();
  if (!doc?.package?.document) return;
  const existing = doc.package.document.finalSectionProperties ?? {};
  doc.package.document.finalSectionProperties = { ...existing, ...sp };
  // Bump stateTick so `currentSectionProps` re-evaluates and the
  // rulers receive the new sectionProperties prop. Without this the
  // document is mutated but the rulers keep showing the old margin
  // because Vue's reactivity doesn't see the deep mutation through
  // shallowRef.
  stateTick.value++;
  // Re-render with new page dimensions (empty tr won't trigger docChanged)
  reLayout();
  emit('change', doc);
}

// Ruler-driven margin/indent handlers — port of React DocxEditor.tsx
// 3416-3520. The horizontal ruler emits left/right margin + first-line
// /left/right indent + tab-stop-remove events; the vertical ruler emits
// top/bottom margin events. Without these listeners the markers were
// draggable but the document never updated.

function applyMarginChange(
  property: 'marginLeft' | 'marginRight' | 'marginTop' | 'marginBottom',
  twips: number
) {
  if (readOnly.value) return;
  handlePageSetupApply({ [property]: twips });
}

function handleLeftMarginChange(twips: number) {
  applyMarginChange('marginLeft', twips);
}
function handleRightMarginChange(twips: number) {
  applyMarginChange('marginRight', twips);
}
function handleTopMarginChange(twips: number) {
  applyMarginChange('marginTop', twips);
}
function handleBottomMarginChange(twips: number) {
  applyMarginChange('marginBottom', twips);
}

function handleIndentLeftChange(twips: number) {
  const view = editorView.value;
  if (!view) return;
  setIndentLeft(twips)(view.state, view.dispatch);
}
function handleIndentRightChange(twips: number) {
  const view = editorView.value;
  if (!view) return;
  setIndentRight(twips)(view.state, view.dispatch);
}
function handleFirstLineIndentChange(twips: number) {
  const view = editorView.value;
  if (!view) return;
  // Negative twips → hanging indent (matches React's flag-shape API).
  if (twips < 0) {
    setIndentFirstLine(-twips, true)(view.state, view.dispatch);
  } else {
    setIndentFirstLine(twips, false)(view.state, view.dispatch);
  }
}
function handleTabMarkRemove(positionTwips: number) {
  const view = editorView.value;
  if (!view) return;
  removeTabMark(positionTwips)(view.state, view.dispatch);
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
// Image clipboard & replace helpers
// =========================================================================

function copyImageToClipboard(view: EditorView, pmPos: number) {
  const node = view.state.doc.nodeAt(pmPos);
  if (!node || node.type.name !== 'image') return;

  const src = node.attrs.src as string;
  // Write both HTML (for pasting back as image node) and the image blob if possible
  const imgHtml = `<img src="${src}" data-pm-image="true" data-width="${node.attrs.width ?? ''}" data-height="${node.attrs.height ?? ''}" data-wrap-type="${node.attrs.wrapType ?? ''}" data-display-mode="${node.attrs.displayMode ?? ''}" data-rid="${node.attrs.rId ?? ''}" />`;

  const clipboardItem = new ClipboardItem({
    'text/html': new Blob([imgHtml], { type: 'text/html' }),
    'text/plain': new Blob(['[image]'], { type: 'text/plain' }),
  });
  navigator.clipboard.write([clipboardItem]).catch(() => {
    // Fallback: at least copy as HTML
    const ta = document.createElement('textarea');
    ta.value = imgHtml;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

async function pasteFromClipboard(view: EditorView) {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      // Check for image types first
      const imageType = item.types.find((t) => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getBlob(imageType);
        const dataUrl = await blobToDataUrl(blob);
        const dims = await loadImageDimensions(dataUrl);
        const maxW = 612;
        let w = dims.width,
          h = dims.height;
        if (w > maxW) {
          h = Math.round(h * (maxW / w));
          w = maxW;
        }
        const imageNode = view.state.schema.nodes.image.create({
          src: dataUrl,
          width: w,
          height: h,
          rId: `rId_img_${Date.now()}`,
          wrapType: 'inline',
          displayMode: 'inline',
        });
        const { from } = view.state.selection;
        view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
        return;
      }

      // Check for HTML with image
      if (item.types.includes('text/html')) {
        const htmlBlob = await item.getBlob('text/html');
        const html = await htmlBlob.text();
        const match = html.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
        if (match && match[1]) {
          const src = match[1];
          const widthMatch = html.match(/data-width="(\d+)"/);
          const heightMatch = html.match(/data-height="(\d+)"/);
          const w = widthMatch ? Number(widthMatch[1]) : 200;
          const h = heightMatch ? Number(heightMatch[1]) : 200;
          const imageNode = view.state.schema.nodes.image.create({
            src,
            width: w || 200,
            height: h || 200,
            rId: `rId_img_${Date.now()}`,
            wrapType: 'inline',
            displayMode: 'inline',
          });
          view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
          return;
        }
      }

      // Fall back to text paste
      if (item.types.includes('text/plain')) {
        const textBlob = await item.getBlob('text/plain');
        const text = await textBlob.text();
        if (text && text !== '[image]') {
          const { from } = view.state.selection;
          view.dispatch(view.state.tr.insertText(text, from));
        }
        return;
      }
    }
  } catch {
    // Fallback for browsers without clipboard API
    const text = await navigator.clipboard?.readText();
    if (text) {
      const { from } = view.state.selection;
      view.dispatch(view.state.tr.insertText(text, from));
    }
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 200, height: 200 });
    img.src = src;
  });
}

function triggerReplaceImage(view: EditorView, pmPos: number) {
  const node = view.state.doc.nodeAt(pmPos);
  if (!node || node.type.name !== 'image') return;

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const dataUrl = await blobToDataUrl(file);
    const dims = await loadImageDimensions(dataUrl);

    // Keep existing dimensions unless the aspect ratio is wildly different;
    // scale the new image to fit within the old bounding box.
    const oldW = (node.attrs.width as number) || dims.width;
    const oldH = (node.attrs.height as number) || dims.height;
    const scale = Math.min(oldW / dims.width, oldH / dims.height);
    const newW = Math.round(dims.width * scale);
    const newH = Math.round(dims.height * scale);

    try {
      const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
        ...node.attrs,
        src: dataUrl,
        width: newW,
        height: newH,
        rId: `rId_img_${Date.now()}`,
      });
      view.dispatch(tr);
    } catch {
      // position may have changed
    }
  };
  input.click();
}

// =========================================================================
// Context menu
// =========================================================================

function handleContextMenu(event: MouseEvent) {
  const view = editorView.value;
  if (!view) return;
  const target = event.target as HTMLElement;

  // Check if right-click is on an image
  const imageEl = findImageElement(target);
  if (imageEl) {
    const docFrom = Number(imageEl.dataset.docFrom);
    if (!isNaN(docFrom)) {
      try {
        const sel = NodeSelection.create(view.state.doc, docFrom);
        view.dispatch(view.state.tr.setSelection(sel));
      } catch {
        /* ignore */
      }
      selectedImage.value = {
        element: imageEl,
        pmPos: docFrom,
        width: imageEl.offsetWidth,
        height: imageEl.offsetHeight,
      };
      clearOverlay();

      // Image right-click takes priority over the text context menu —
      // surface the layout-options menu instead and bail out.
      const node = view.state.doc.nodeAt(docFrom);
      if (node && node.type.name === 'image') {
        const wrapType = (node.attrs.wrapType as WrapType | undefined) ?? 'inline';
        const cssFloat = node.attrs.cssFloat as 'left' | 'right' | 'none' | null | undefined;
        imageContextMenu.value = {
          open: true,
          position: { x: event.clientX, y: event.clientY },
          pmPos: docFrom,
          currentWrapType: wrapType,
          currentCssFloat: cssFloat ?? null,
          inlinePositionEmu:
            wrapType === 'inline' ? captureInlinePositionEmu(imageEl, zoom.value) : undefined,
        };
        contextMenu.value.isOpen = false;
        return;
      }
    }
  }

  // Move the PM caret to the right-click point unless the click landed
  // inside the current selection (or exactly on a collapsed caret —
  // re-dispatching the same position would force a needless re-layout).
  // Mirrors React's PagedEditor: table ops and other caret-scoped
  // actions then operate on the cell/run the user actually clicked.
  {
    const { from, to } = view.state.selection;
    const clickPos = resolvePos(event.clientX, event.clientY);
    if (clickPos !== null && (clickPos < from || clickPos > to)) {
      try {
        setPmSelection(clickPos);
      } catch {
        // resolved position may be out of range after a concurrent edit
      }
    }
  }

  const tableCtx = getTableContext(view.state);
  const { empty } = view.state.selection;

  // Right-clicking outside an image clears any open image context menu
  // — otherwise the image menu can stay visible while TextContextMenu
  // is shown over a different element. Mirrors React's PagedEditor
  // exclusivity (only one of the two menus visible at a time).
  if (imageContextMenu.value) imageContextMenu.value = null;

  contextMenu.value = {
    isOpen: true,
    position: { x: event.clientX, y: event.clientY },
    hasSelection: !empty,
    inTable: tableCtx.isInTable,
    onImage: !!imageEl,
    canMergeCells: !!tableCtx.hasMultiCellSelection,
    canSplitCell: !!tableCtx.canSplitCell,
  };
}

function handleSelectedImageContextMenu(event: MouseEvent) {
  const view = editorView.value;
  const sel = selectedImage.value;
  if (!view || !sel) return;
  const node = view.state.doc.nodeAt(sel.pmPos);
  if (!node || node.type.name !== 'image') return;
  const wrapType = (node.attrs.wrapType as WrapType | undefined) ?? 'inline';
  const cssFloat = node.attrs.cssFloat as 'left' | 'right' | 'none' | null | undefined;
  imageContextMenu.value = {
    open: true,
    position: { x: event.clientX, y: event.clientY },
    pmPos: sel.pmPos,
    currentWrapType: wrapType,
    currentCssFloat: cssFloat ?? null,
    inlinePositionEmu:
      wrapType === 'inline' ? captureInlinePositionEmu(sel.element, zoom.value) : undefined,
  };
  contextMenu.value.isOpen = false;
}

function handleImageWrapSelect(target: ImageLayoutTarget) {
  const view = editorView.value;
  const state = imageContextMenu.value;
  if (!view || !state) return;
  const cmds = getCommands();
  const opts =
    state.inlinePositionEmu && target !== 'inline'
      ? { initialPositionEmu: state.inlinePositionEmu }
      : undefined;
  const cmd = cmds.setImageWrapType?.(state.pmPos, target, opts);
  if (!cmd) return;
  cmd(view.state, (tr: any) => view.dispatch(tr), view);
  view.focus();
}

// Toolbar image group: read the live image attrs from the PM doc at the
// selected image's position so the wrap dropdown highlights the correct
// active option. Only the three fields the toolbar dropdown reads — wrap
// dropdown is the only UI element wired to this context in v1.
const imageToolbarContext = computed<{
  wrapType: string;
  displayMode: string;
  cssFloat: string | null;
} | null>(() => {
  void stateTick.value;
  const view = editorView.value;
  const sel = selectedImage.value;
  if (!view || !sel) return null;
  const node = view.state.doc.nodeAt(sel.pmPos);
  if (!node || node.type.name !== 'image') return null;
  return {
    wrapType: (node.attrs.wrapType as string) ?? 'inline',
    displayMode: (node.attrs.displayMode as string) ?? 'inline',
    cssFloat: (node.attrs.cssFloat as string) ?? null,
  };
});

// Toolbar wrap dropdown → core PM command. Translates the legacy
// toolbar vocabulary via `toolbarValueToLayoutTarget` so this path
// shares `setImageWrapType` with the right-click menu.
function handleToolbarImageWrap(value: string) {
  const view = editorView.value;
  const sel = selectedImage.value;
  if (!view || !sel) return;
  const target = toolbarValueToLayoutTarget(value);
  if (!target) return;
  const node = view.state.doc.nodeAt(sel.pmPos);
  const cmds = getCommands();
  const opts =
    node?.attrs.wrapType === 'inline' && target !== 'inline'
      ? { initialPositionEmu: captureInlinePositionEmu(sel.element, zoom.value) }
      : undefined;
  const cmd = cmds.setImageWrapType?.(sel.pmPos, target, opts);
  if (!cmd) return;
  cmd(view.state, (tr: any) => view.dispatch(tr), view);
  view.focus();
}

// Toolbar transform dropdown → mutate the selected image's
// `transform` attribute. Rotate is folded mod 360, flip toggles bit
// flags, then the parts are joined back into a CSS transform string.
function handleImageTransform(action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV') {
  const view = editorView.value;
  const sel = selectedImage.value;
  if (!view || !sel) return;
  const node = view.state.doc.nodeAt(sel.pmPos);
  if (!node || node.type.name !== 'image') return;

  const current = (node.attrs.transform as string | null) || '';
  const rotateMatch = current.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  let rotation = rotateMatch ? parseFloat(rotateMatch[1]) : 0;
  let flipH = /scaleX\(-1\)/.test(current);
  let flipV = /scaleY\(-1\)/.test(current);

  if (action === 'rotateCW') rotation = (rotation + 90) % 360;
  else if (action === 'rotateCCW') rotation = (rotation - 90 + 360) % 360;
  else if (action === 'flipH') flipH = !flipH;
  else if (action === 'flipV') flipV = !flipV;

  const parts: string[] = [];
  if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
  if (flipH) parts.push('scaleX(-1)');
  if (flipV) parts.push('scaleY(-1)');
  const next = parts.length > 0 ? parts.join(' ') : null;

  const tr = view.state.tr.setNodeMarkup(sel.pmPos, undefined, {
    ...node.attrs,
    transform: next,
  });
  view.dispatch(tr.scrollIntoView());
  view.focus();
}

function handleContextMenuAction(action: string) {
  const view = editorView.value;
  if (!view) return;
  const cmds = getCommands();

  switch (action) {
    case 'cut':
      if (selectedImage.value) {
        copyImageToClipboard(view, selectedImage.value.pmPos);
        const pos = selectedImage.value.pmPos;
        const node = view.state.doc.nodeAt(pos);
        if (node) {
          view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
          selectedImage.value = null;
        }
      } else {
        document.execCommand('cut');
      }
      break;
    case 'copy':
      if (selectedImage.value) {
        copyImageToClipboard(view, selectedImage.value.pmPos);
      } else {
        document.execCommand('copy');
      }
      break;
    case 'paste':
      pasteFromClipboard(view);
      break;
    case 'pasteAsPlainText':
      // Strip all formatting — insert the clipboard's text/plain only.
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) view.dispatch(view.state.tr.insertText(text).scrollIntoView());
        })
        .catch(() => {
          // Clipboard read denied — nothing to paste.
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
    case 'imageProperties':
      if (selectedImage.value) {
        showImageProperties.value = true;
      }
      break;
    case 'replaceImage':
      if (selectedImage.value) {
        triggerReplaceImage(view, selectedImage.value.pmPos);
      }
      break;
    case 'deleteImage': {
      if (selectedImage.value) {
        const pos = selectedImage.value.pmPos;
        const node = view.state.doc.nodeAt(pos);
        if (node) {
          view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
          selectedImage.value = null;
        }
      }
      break;
    }
    case 'addRowAbove':
    case 'addRowBelow':
    case 'deleteRow':
    case 'addColumnLeft':
    case 'addColumnRight':
    case 'deleteColumn':
    case 'mergeCells':
    case 'splitCell': {
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

function handleTrackedChangeReply(revisionId: number, text: string) {
  // Replies threaded under a tracked change use parentId =
  // revisionId so the same comments.xml shape React produces is
  // round-tripped back to OOXML. UnifiedSidebar's
  // useCommentSidebarItems puts these next to the tc card via
  // repliesByParent.get(revisionId).
  const doc = getDocument();
  if (!doc?.package?.document) return;
  if (!doc.package.document.comments) doc.package.document.comments = [];
  const maxId = doc.package.document.comments.reduce((m, c) => Math.max(m, c.id), 0);
  const reply: Comment = {
    id: maxId + 1,
    author: 'User',
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        properties: {},
        content: [{ type: 'run', properties: {}, content: [{ type: 'text', text }] }],
      },
    ] as any,
    parentId: revisionId,
  };
  doc.package.document.comments.push(reply);
  comments.value = [...doc.package.document.comments];
  emit('change', doc);
}

function handleCommentReply(commentId: number, text: string) {
  const doc = getDocument();
  if (!doc?.package?.document?.comments) return;

  const maxId = doc.package.document.comments.reduce((max, c) => Math.max(max, c.id), 0);
  const reply: Comment = {
    id: maxId + 1,
    author: 'User',
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        properties: {},
        content: [{ type: 'run', properties: {}, content: [{ type: 'text', text }] }],
      },
    ] as any,
    parentId: commentId,
  };
  doc.package.document.comments.push(reply);
  comments.value = [...doc.package.document.comments];
  emit('change', doc);
}

function handleCommentResolve(commentId: number) {
  const doc = getDocument();
  if (!doc?.package?.document?.comments) return;
  const c = doc.package.document.comments.find((c) => c.id === commentId);
  if (c) c.done = true;
  comments.value = [...doc.package.document.comments];
  emit('change', doc);
}

function handleCommentUnresolve(commentId: number) {
  const doc = getDocument();
  if (!doc?.package?.document?.comments) return;
  const c = doc.package.document.comments.find((c) => c.id === commentId);
  if (c) c.done = false;
  comments.value = [...doc.package.document.comments];
  emit('change', doc);
}

function handleCommentDelete(commentId: number) {
  const doc = getDocument();
  if (!doc?.package?.document?.comments) return;
  // Remove comment and its replies
  doc.package.document.comments = doc.package.document.comments.filter(
    (c) => c.id !== commentId && c.parentId !== commentId
  );
  comments.value = [...doc.package.document.comments];
  emit('change', doc);
}

function handleAcceptChange(from: number, to: number) {
  const view = editorView.value;
  if (!view) return;
  // Route through the shared core command so any future change to
  // accept/reject semantics (e.g. real text deletion for `deletion`
  // marks) lands in both adapters at once.
  acceptChange(from, to)(view.state, view.dispatch);
  extractCommentsAndChanges();
  view.focus();
}

function handleRejectChange(from: number, to: number) {
  const view = editorView.value;
  if (!view) return;
  rejectChange(from, to)(view.state, view.dispatch);
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
  if (props.disableFindReplaceShortcuts && (e.key === 'f' || e.key === 'h')) return;
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
  pagesViewportRef.value?.addEventListener('scroll', handleViewportScroll, { passive: true });
});

onBeforeUnmount(() => {
  clearTableInsertTimer();
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
  window.removeEventListener('keydown', handleKeyDown);
  pagesViewportRef.value?.removeEventListener('scroll', handleViewportScroll);
  if (scrollFadeTimer) clearTimeout(scrollFadeTimer);
  clearOverlay();
});

// `satisfies DocxEditorRef` enforces signatures against
// EditorRefLike at typecheck time (Decision 10 in the 1.0 spec) without
// affecting the runtime shape exposed via defineExpose.
const exposed = {
  getAgent: () => null,
  save,
  setZoom,
  getZoom,
  focus,
  scrollToPage,
  scrollToPosition,
  openPrintPreview,
  print,
  loadDocument,
  loadDocumentBuffer,
  destroy,
  getDocument,
  getEditorRef,
  addComment,
  replyToComment,
  resolveComment,
  proposeChange,
  scrollToParaId,
  findInDocument,
  getSelectionInfo,
  getComments,
  applyFormatting,
  setParagraphStyle,
  getPageContent,
  getTotalPages,
  getCurrentPage,
  onContentChange,
  onSelectionChange,
} satisfies DocxEditorRef;
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
