<!--
  The formatting rail — Vue counterpart of React's <Toolbar>
  (packages/react/src/components/Toolbar.tsx). Button order, dropdowns,
  and groupings match React's render order so the parity preview shows
  the same rail in the same sequence. Rendered by DocxEditorVue and
  exposed publicly as `Toolbar`.
-->
<template>
  <div class="basic-toolbar" v-if="view">
    <!-- 1. Undo / Redo -->
    <button title="Undo (Ctrl+Z)" :disabled="!canUndo" @mousedown.prevent="execCommand('undo')">
      <MaterialSymbol name="undo" />
    </button>
    <button title="Redo (Ctrl+Y)" :disabled="!canRedo" @mousedown.prevent="execCommand('redo')">
      <MaterialSymbol name="redo" />
    </button>

    <span class="divider" />

    <!-- 2. Zoom (compact: -, 100%, +) -->
    <div v-if="showZoomControl" class="toolbar-dropdown zoom-group" ref="zoomDropdownRef">
      <button
        class="size-btn"
        @mousedown.prevent="$emit('zoom-out')"
        :disabled="isMinZoom"
        title="Zoom out"
      >
        −
      </button>
      <button
        class="toolbar-dropdown__trigger zoom-trigger"
        @mousedown.prevent="toggleDropdown('zoom')"
        title="Zoom level"
      >
        {{ zoomPercent }}%
      </button>
      <button
        class="size-btn"
        @mousedown.prevent="$emit('zoom-in')"
        :disabled="isMaxZoom"
        title="Zoom in"
      >
        +
      </button>
      <div
        v-if="openDropdown === 'zoom'"
        :style="dropdownMenuStyle"
        class="toolbar-dropdown__menu zoom-menu"
      >
        <button
          v-for="p in zoomPresets"
          :key="p"
          class="toolbar-dropdown__item"
          :class="{ active: zoomPercent === Math.round(p * 100) }"
          @mousedown.prevent="$emit('zoom-set', p)"
        >
          {{ Math.round(p * 100) }}%
        </button>
      </div>
    </div>

    <span class="divider" />

    <!-- 3. Style Picker -->
    <div class="toolbar-dropdown" ref="styleDropdownRef">
      <button
        class="toolbar-dropdown__trigger style-trigger"
        @mousedown.prevent="toggleDropdown('style')"
        :title="'Paragraph style'"
      >
        {{ currentStyleLabel }}
        <MaterialSymbol class="chevron" name="arrow_drop_down" :size="16" />
      </button>
      <div
        v-if="openDropdown === 'style'"
        :style="dropdownMenuStyle"
        class="toolbar-dropdown__menu style-menu"
      >
        <button
          v-for="s in paragraphStyles"
          :key="s.id"
          class="toolbar-dropdown__item"
          :class="{ active: (ctx.paragraphFormatting.styleId || 'Normal') === s.id }"
          :style="s.previewStyle"
          @mousedown.prevent="handleApplyStyle(s.id)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>

    <span class="divider" />

    <!-- 4. Font Family Picker -->
    <div class="toolbar-dropdown" ref="fontDropdownRef">
      <button
        class="toolbar-dropdown__trigger font-trigger"
        @mousedown.prevent="toggleDropdown('font')"
        title="Font family"
      >
        {{ currentFontFamily }}
        <MaterialSymbol class="chevron" name="arrow_drop_down" :size="16" />
      </button>
      <div
        v-if="openDropdown === 'font'"
        :style="dropdownMenuStyle"
        class="toolbar-dropdown__menu font-menu"
      >
        <template v-for="group in fontGroups" :key="group.label">
          <div v-if="group.fonts.length > 0" class="toolbar-dropdown__group-label">
            {{ group.label }}
          </div>
          <button
            v-for="f in group.fonts"
            :key="f.name"
            class="toolbar-dropdown__item"
            :class="{ active: currentFontFamily === f.name }"
            :style="{ fontFamily: f.fontFamily }"
            @mousedown.prevent="setFont(f.name)"
          >
            {{ f.name }}
          </button>
        </template>
      </div>
    </div>

    <!-- 5. Font Size: −, value, + -->
    <div class="toolbar-dropdown font-size-group" ref="sizeDropdownRef">
      <button class="size-btn" @mousedown.prevent="decreaseFontSize" title="Decrease font size">
        −
      </button>
      <button
        class="toolbar-dropdown__trigger size-trigger"
        @mousedown.prevent="toggleDropdown('size')"
        title="Font size"
      >
        {{ currentFontSize }}
      </button>
      <button class="size-btn" @mousedown.prevent="increaseFontSize" title="Increase font size">
        +
      </button>
      <div
        v-if="openDropdown === 'size'"
        :style="dropdownMenuStyle"
        class="toolbar-dropdown__menu size-menu"
      >
        <button
          v-for="s in fontSizePresets"
          :key="s"
          class="toolbar-dropdown__item"
          :class="{ active: currentFontSize === s }"
          @mousedown.prevent="setFontSize(s)"
        >
          {{ s }}
        </button>
      </div>
    </div>

    <span class="divider" />

    <!-- 6. Bold / Italic / Underline / Strike -->
    <button
      title="Bold (Ctrl+B)"
      :class="{ active: ctx.textFormatting.bold }"
      @mousedown.prevent="execCommand('toggleBold')"
    >
      <MaterialSymbol name="format_bold" />
    </button>
    <button
      title="Italic (Ctrl+I)"
      :class="{ active: ctx.textFormatting.italic }"
      @mousedown.prevent="execCommand('toggleItalic')"
    >
      <MaterialSymbol name="format_italic" />
    </button>
    <button
      title="Underline (Ctrl+U)"
      :class="{ active: !!ctx.textFormatting.underline }"
      @mousedown.prevent="execCommand('toggleUnderline')"
    >
      <MaterialSymbol name="format_underlined" />
    </button>
    <button
      title="Strikethrough"
      :class="{ active: ctx.textFormatting.strike }"
      @mousedown.prevent="execCommand('toggleStrike')"
    >
      <MaterialSymbol name="strikethrough_s" />
    </button>

    <!-- 7. Text color — Word-style split button + advanced picker (theme matrix) -->
    <ColorPicker
      mode="text"
      :value="currentTextColorHex"
      :theme="theme ?? null"
      @change="onTextColor"
    />

    <!-- 8. Highlight — Word-style split button + advanced picker -->
    <ColorPicker
      mode="highlight"
      :value="currentHighlightHex"
      :theme="theme ?? null"
      @change="onHighlight"
    />

    <!-- 9. Link -->
    <button title="Insert link (Ctrl+K)" @mousedown.prevent="$emit('insert-link')">
      <MaterialSymbol name="link" />
    </button>

    <!-- 10. Superscript / Subscript -->
    <button
      title="Superscript (Ctrl+Shift+=)"
      :class="{ active: ctx.textFormatting.vertAlign === 'superscript' }"
      @mousedown.prevent="execCommand('toggleSuperscript')"
    >
      <MaterialSymbol name="superscript" />
    </button>
    <button
      title="Subscript (Ctrl+=)"
      :class="{ active: ctx.textFormatting.vertAlign === 'subscript' }"
      @mousedown.prevent="execCommand('toggleSubscript')"
    >
      <MaterialSymbol name="subscript" />
    </button>

    <span class="divider" />

    <!-- 11. Alignment dropdown (current align icon + chevron) -->
    <div class="toolbar-dropdown" ref="alignDropdownRef">
      <button
        class="toolbar-dropdown__trigger align-trigger"
        @mousedown.prevent="toggleDropdown('align')"
        title="Alignment"
      >
        <MaterialSymbol :name="alignIconName" />
        <MaterialSymbol class="chevron" name="arrow_drop_down" :size="16" />
      </button>
      <div
        v-if="openDropdown === 'align'"
        :style="dropdownMenuStyle"
        class="toolbar-dropdown__menu align-menu"
      >
        <button
          class="toolbar-dropdown__item dropdown-item--icon"
          :class="{ active: currentAlignment === 'left' }"
          @mousedown.prevent="
            execCommand('alignLeft');
            openDropdown = null;
          "
        >
          <MaterialSymbol name="format_align_left" :size="18" /> Left (Ctrl+L)
        </button>
        <button
          class="toolbar-dropdown__item dropdown-item--icon"
          :class="{ active: currentAlignment === 'center' }"
          @mousedown.prevent="
            execCommand('alignCenter');
            openDropdown = null;
          "
        >
          <MaterialSymbol name="format_align_center" :size="18" /> Center (Ctrl+E)
        </button>
        <button
          class="toolbar-dropdown__item dropdown-item--icon"
          :class="{ active: currentAlignment === 'right' }"
          @mousedown.prevent="
            execCommand('alignRight');
            openDropdown = null;
          "
        >
          <MaterialSymbol name="format_align_right" :size="18" /> Right (Ctrl+R)
        </button>
        <button
          class="toolbar-dropdown__item dropdown-item--icon"
          :class="{ active: currentAlignment === 'both' }"
          @mousedown.prevent="
            execCommand('alignJustify');
            openDropdown = null;
          "
        >
          <MaterialSymbol name="format_align_justify" :size="18" /> Justify (Ctrl+J)
        </button>
      </div>
    </div>

    <!-- 12. Lists + Indent -->
    <button
      title="Bullet List"
      :class="{ active: ctx.inList && ctx.listType === 'bullet' }"
      @mousedown.prevent="execCommand('toggleBulletList')"
    >
      <MaterialSymbol name="format_list_bulleted" />
    </button>
    <button
      title="Numbered List"
      :class="{ active: ctx.inList && ctx.listType === 'numbered' }"
      @mousedown.prevent="execCommand('toggleNumberedList')"
    >
      <MaterialSymbol name="format_list_numbered" />
    </button>
    <button
      title="Decrease Indent (Shift+Tab)"
      :disabled="!canOutdent"
      @mousedown.prevent="execCommand('outdent')"
    >
      <MaterialSymbol name="format_indent_decrease" />
    </button>
    <button title="Increase Indent (Tab)" @mousedown.prevent="execCommand('indent')">
      <MaterialSymbol name="format_indent_increase" />
    </button>

    <!-- 13. Line Spacing -->
    <div class="toolbar-dropdown" ref="spacingDropdownRef">
      <button
        class="toolbar-dropdown__trigger"
        @mousedown.prevent="toggleDropdown('spacing')"
        title="Line spacing"
      >
        <MaterialSymbol name="format_line_spacing" />
        <MaterialSymbol class="chevron" name="arrow_drop_down" :size="16" />
      </button>
      <div
        v-if="openDropdown === 'spacing'"
        :style="dropdownMenuStyle"
        class="toolbar-dropdown__menu"
      >
        <button
          v-for="sp in lineSpacingOptions"
          :key="sp.value"
          class="toolbar-dropdown__item"
          :class="{ active: isCurrentLineSpacing(sp.value) }"
          @mousedown.prevent="setLineSpacing(sp.value)"
        >
          {{ sp.label }}
        </button>
      </div>
    </div>

    <!-- 14. Clear Formatting -->
    <button title="Clear formatting" @mousedown.prevent="handleClearFormatting">
      <MaterialSymbol name="format_clear" />
    </button>

    <span class="divider" />

    <!-- 15. Comments & Changes -->
    <button
      title="Comments & Changes"
      :class="{ active: commentsSidebarOpen }"
      @mousedown.prevent="$emit('toggle-sidebar')"
    >
      <MaterialSymbol name="comment" />
    </button>

    <!-- 15.5 Image context group — wrap-mode dropdown + transform
         (rotate/flip) + image-properties tune button. Visible only
         when a NodeSelection lands on an image node. -->
    <template v-if="imageContext">
      <span class="divider" />
      <ImageWrapDropdown
        :image-context="imageContext"
        @change="(v) => $emit('image-wrap-type', v)"
      />
      <ImageTransformDropdown @transform="(a) => $emit('image-transform', a)" />
      <button title="Image properties" @mousedown.prevent="$emit('image-properties')">
        <MaterialSymbol name="tune" />
      </button>
    </template>

    <!-- 16. Table context buttons — visible only when cursor is in a
         table. Hosted via a named slot so the buttons render inline
         inside this pill instead of a separate row. -->
    <slot name="table-context" />

    <!-- 17. Editing-mode dropdown — flows inline after the comments
         button with a divider before it. -->
    <span class="divider" />
    <EditingModeDropdown
      v-if="editorMode"
      :model-value="editorMode"
      @update:model-value="(m: any) => $emit('mode-change', m)"
    />
    <slot name="toolbar-extra" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { undoDepth, redoDepth } from 'prosemirror-history';
import { extractSelectionContext } from '@eigenpal/docx-editor-core/prosemirror/plugins/selectionTracker';
import { clearFormatting } from '@eigenpal/docx-editor-core/prosemirror/commands/formatting';
import MaterialSymbol from './ui/MaterialSymbol.vue';
import ColorPicker from './ui/ColorPicker.vue';
import EditingModeDropdown, { type EditorMode } from './EditingModeDropdown.vue';
import ImageWrapDropdown from './ui/ImageWrapDropdown.vue';
import ImageTransformDropdown, {
  type TransformAction as ImageTransformAction,
} from './ui/ImageTransformDropdown.vue';
import type { SelectionContext } from '@eigenpal/docx-editor-core/prosemirror/plugins/selectionTracker';
import type { ColorValue, Theme } from '@eigenpal/docx-editor-core/types/document';
import {
  normalizeFontFamilies,
  type FontOption,
} from '@eigenpal/docx-editor-core/utils/fontOptions';
import {
  defaultFonts,
  fontSizePresets,
  paragraphStyles,
  lineSpacingOptions,
  ZOOM_PRESETS,
  DEFAULT_ZOOM_PERCENT,
} from './Toolbar/presets';
import { useToolbarDropdowns } from '../composables/useToolbarDropdowns';

/**
 * Image context — populated by the host when a NodeSelection lands on
 * an image node. Drives the wrap dropdown's active-value math
 * (e.g. `displayMode === 'float'`) and the "Image properties" button.
 */
export interface ImageToolbarContext {
  wrapType: string;
  displayMode: string;
  cssFloat: string | null;
}

const props = defineProps<{
  view: EditorView | null;
  getCommands: () => Record<string, (...args: any[]) => any>;
  stateTick: number;
  zoomPercent?: number;
  isMinZoom?: boolean;
  isMaxZoom?: boolean;
  zoomPresets?: number[];
  showZoomControl?: boolean;
  editorMode?: EditorMode;
  /** Whether the comments sidebar is currently open — drives the
      active state on the comments toolbar button. */
  commentsSidebarOpen?: boolean;
  /** Image-node selection context — when non-null, the image group
      (wrap dropdown + properties button) renders inline inside the
      pill, just like React's Toolbar. */
  imageContext?: ImageToolbarContext | null;
  /** Document theme — feeds the color picker's theme-color matrix. */
  theme?: Theme | null;
  /** Optional custom font list matching React's `fontFamilies` prop. */
  fontFamilies?: ReadonlyArray<string | FontOption>;
}>();

const emit = defineEmits<{
  (e: 'find-replace'): void;
  (e: 'insert-table'): void;
  (e: 'insert-image'): void;
  (e: 'insert-link'): void;
  (e: 'insert-symbol'): void;
  (e: 'insert-page-break'): void;
  (e: 'insert-toc'): void;
  (e: 'page-setup'): void;
  (e: 'toggle-outline'): void;
  (e: 'zoom-in'): void;
  (e: 'zoom-out'): void;
  (e: 'zoom-set', level: number): void;
  (e: 'toggle-sidebar'): void;
  (e: 'apply-style', styleId: string): void;
  (e: 'mode-change', mode: EditorMode): void;
  (e: 'image-wrap-type', wrapType: string): void;
  (e: 'image-properties'): void;
  (e: 'image-transform', action: ImageTransformAction): void;
}>();

// =========================================================================
// Dropdown state
// =========================================================================

const zoomPercent = computed(() => props.zoomPercent ?? DEFAULT_ZOOM_PERCENT);
const isMinZoom = computed(() => props.isMinZoom ?? false);
const isMaxZoom = computed(() => props.isMaxZoom ?? false);
const zoomPresets = computed(() => props.zoomPresets ?? ZOOM_PRESETS);
const showZoomControl = computed(() => props.showZoomControl ?? true);

const styleDropdownRef = ref<HTMLElement | null>(null);
const fontDropdownRef = ref<HTMLElement | null>(null);
const sizeDropdownRef = ref<HTMLElement | null>(null);
const alignDropdownRef = ref<HTMLElement | null>(null);
const spacingDropdownRef = ref<HTMLElement | null>(null);
const zoomDropdownRef = ref<HTMLElement | null>(null);

// `.basic-toolbar` uses `overflow-x: auto` for narrow-viewport scrolling,
// which forces overflow-y to clip per the CSS spec. Dropdowns therefore
// can't escape via `position: absolute` — `useToolbarDropdowns` renders
// each menu with `position: fixed` and recomputes coords on every open.
const { openDropdown, dropdownMenuStyle, toggleDropdown } = useToolbarDropdowns({
  zoom: zoomDropdownRef,
  style: styleDropdownRef,
  font: fontDropdownRef,
  size: sizeDropdownRef,
  align: alignDropdownRef,
  spacing: spacingDropdownRef,
});

// =========================================================================
// Selection context (reactive via stateTick)
// =========================================================================

const ctx = computed<SelectionContext>(() => {
  void props.stateTick;
  const v = props.view;
  if (!v) {
    return {
      hasSelection: false,
      isMultiParagraph: false,
      textFormatting: {},
      paragraphFormatting: {},
      startParagraphIndex: 0,
      endParagraphIndex: 0,
      inList: false,
      activeCommentIds: [],
      inInsertion: false,
      inDeletion: false,
    };
  }
  return extractSelectionContext(v.state);
});

// =========================================================================
// Derived state for toolbar display
// =========================================================================

// All of the mark-driven displays (font family / size / colors) read from
// `ctx.value.textFormatting`, which is built by core's `extractSelectionContext`
// and correctly handles both cursor and range selections — including the
// "$from at a mark boundary" case. No local mark snapshot needed.

const currentFontFamily = computed(() => {
  const ff = ctx.value.textFormatting.fontFamily;
  return ff?.ascii || ff?.hAnsi || 'Arial';
});

const currentFontSize = computed(() => {
  const sz = ctx.value.textFormatting.fontSize;
  return sz ? sz / 2 : 11; // half-points to points
});

const currentAlignment = computed(() => {
  return ctx.value.paragraphFormatting.alignment || 'left';
});

const alignIconName = computed(() => {
  switch (currentAlignment.value) {
    case 'center':
      return 'format_align_center';
    case 'right':
      return 'format_align_right';
    case 'both':
      return 'format_align_justify';
    default:
      return 'format_align_left';
  }
});

const currentStyleLabel = computed(() => {
  const id = ctx.value.paragraphFormatting.styleId || 'Normal';
  const s = paragraphStyles.find((ps) => ps.id === id);
  return s?.label || id;
});

// Mirror React Toolbar's `canUndo` / `canRedo` props (Toolbar.tsx:81-82).
// React threads them in from a parent hook; Vue computes them straight from the
// prosemirror-history plugin state via undoDepth/redoDepth so the buttons grey
// out the same way without needing extra plumbing in DocxEditorVue.
const canUndo = computed(() => {
  void props.stateTick;
  const v = props.view;
  return v ? undoDepth(v.state) > 0 : false;
});
const canRedo = computed(() => {
  void props.stateTick;
  const v = props.view;
  return v ? redoDepth(v.state) > 0 : false;
});

// Mirror React ListButtons.canOutdent (ListButtons.tsx:229) — outdent only fires
// when the cursor is in a list level > 0 OR the paragraph has a left indent.
const canOutdent = computed(() => {
  const c = ctx.value;
  const inListLevel = c.inList && (c.listLevel ?? 0) > 0;
  const hasIndent = (c.paragraphFormatting.indentLeft ?? 0) > 0;
  return inListLevel || hasIndent;
});

// Hex (no `#`, uppercase) of the currently-applied text color, for matching
// the active swatch in the text-color dropdown. Mirrors React's
// `selectedColor` prop on `<StandardColors>` (ColorPicker.tsx:707).
const currentTextColorHex = computed<string | undefined>(() => {
  const rgb = ctx.value.textFormatting.color?.rgb;
  return rgb ? rgb.replace(/^#/, '').toUpperCase() : undefined;
});

// Same for highlight color — React's highlight ColorPicker passes
// `currentFormatting.highlight` straight through as `selectedColor`.
const currentHighlightHex = computed<string | undefined>(() => {
  const h = ctx.value.textFormatting.highlight;
  if (!h || h === 'none') return undefined;
  return h.replace(/^#/, '').toUpperCase();
});

// =========================================================================
// Constants
// =========================================================================

const normalizedFonts = computed(() => normalizeFontFamilies(props.fontFamilies) ?? defaultFonts);
const fontGroups = computed(() => [
  {
    label: 'Sans-serif',
    fonts: normalizedFonts.value.filter((font) => font.category === 'sans-serif'),
  },
  { label: 'Serif', fonts: normalizedFonts.value.filter((font) => font.category === 'serif') },
  {
    label: 'Monospace',
    fonts: normalizedFonts.value.filter((font) => font.category === 'monospace'),
  },
  {
    label: 'Other',
    fonts: normalizedFonts.value.filter((font) => !font.category || font.category === 'other'),
  },
]);

// =========================================================================
// Command helpers
// =========================================================================

function execCommand(name: string, ...args: any[]) {
  const v = props.view;
  if (!v) return;
  const cmds = props.getCommands();
  const cmdFactory = cmds[name];
  if (!cmdFactory) {
    console.warn('[Toolbar] command not found:', name);
    return;
  }
  const command = cmdFactory(...args);
  command(v.state, (tr: any) => v.dispatch(tr), v);
  // The dispatched transaction triggers the host's onSelectionUpdate, which
  // bumps stateTick — `ctx` re-derives marks for the toolbar automatically.
  // Only refocus if PM lost focus — unconditional focus() can dispatch
  // a selection-syncing transaction that clears stored marks.
  if (!v.hasFocus()) v.focus();
  openDropdown.value = null;
}

function setFont(fontName: string) {
  execCommand('setFontFamily', fontName);
}

function setFontSize(size: number) {
  // Commands expect half-points
  execCommand('setFontSize', size * 2);
}

function increaseFontSize() {
  const current = currentFontSize.value;
  const next = fontSizePresets.find((s) => s > current) || current + 2;
  setFontSize(next);
}

function decreaseFontSize() {
  const current = currentFontSize.value;
  const prev = [...fontSizePresets].reverse().find((s) => s < current) || Math.max(1, current - 2);
  setFontSize(prev);
}

function onTextColor(color: ColorValue | string) {
  if (typeof color === 'object' && color.auto) {
    execCommand('clearTextColor');
    return;
  }
  // ColorPicker emits a ColorValue ({ rgb } or themed { themeColor, rgb, themeTint/Shade }).
  execCommand('setTextColor', typeof color === 'string' ? { rgb: color } : color);
}

function handleClearFormatting() {
  const v = props.view;
  if (!v) return;
  clearFormatting(v.state, (tr: any) => v.dispatch(tr), v);
  if (!v.hasFocus()) v.focus();
}

function onHighlight(color: ColorValue | string) {
  // Highlight mode always emits a string ('none' or a hex).
  const value = typeof color === 'string' ? color : (color.rgb ?? 'none');
  execCommand('setHighlight', value);
}

function handleApplyStyle(styleId: string) {
  emit('apply-style', styleId);
  openDropdown.value = null;
}

function setLineSpacing(value: number) {
  execCommand('setLineSpacing', value);
}

function isCurrentLineSpacing(twips: number): boolean {
  const current = ctx.value.paragraphFormatting.lineSpacing;
  if (!current) return twips === 240; // default is single
  return Math.abs(current - twips) < 10;
}
</script>

<style scoped>
/* Pill-shaped toolbar — mirrors React's Toolbar exactly:
   bg #f1f5f9 (slate-100), rounded-full, 36px min-height, px-2 py-1,
   mx-2 mb-1, overflow-x auto. */
.basic-toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 4px 8px;
  margin: 0 8px 4px;
  background: #f1f5f9;
  border-radius: 9999px;
  flex-wrap: nowrap;
  min-height: 36px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.basic-toolbar::-webkit-scrollbar {
  height: 4px;
}
.basic-toolbar::-webkit-scrollbar-thumb {
  background: rgba(15, 23, 42, 0.15);
  border-radius: 2px;
}
/* Buttons match React's `<Button variant="ghost" size="icon-sm">`:
   h-7 w-7 (28×28), slate-500 default text, slate-100/80 hover bg,
   slate-900 + white when active. */
/* Match React's Button base + ghost variant + Toolbar.tsx overrides:
   inline-flex items-center justify-center whitespace-nowrap rounded-md
   text-sm font-medium transition-colors h-7 w-7
   text-slate-500 hover:text-slate-900 hover:bg-slate-100/80
   (text-sm = 14px font-size; rounded-md = 6px; h-7 w-7 = 28×28 square) */
.basic-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #64748b;
  padding: 0;
  white-space: nowrap;
  flex-shrink: 0;
  transition:
    background-color 0.15s ease,
    color 0.15s ease;
}
.basic-toolbar button:hover:not(:disabled) {
  background: rgba(241, 245, 249, 0.8);
  color: #0f172a;
}
.basic-toolbar button:active:not(:disabled) {
  background: rgba(226, 232, 240, 0.8);
}
.basic-toolbar button:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}
.basic-toolbar button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.basic-toolbar button.active {
  background: #0f172a;
  color: #fff;
}
.basic-toolbar button.active:hover {
  background: #1e293b;
  color: #fff;
}
/* Match React's icon size (18px in 28px button). */
.basic-toolbar button :deep(svg) {
  width: 18px;
  height: 18px;
}
/* Dropdown items with leading icons (Insert menu) */
.dropdown-item--icon {
  display: flex !important;
  align-items: center;
  gap: 10px;
  justify-content: flex-start !important;
  padding: 6px 12px !important;
  min-height: 30px;
  font-weight: 400 !important;
}
.dropdown-item--icon :deep(svg) {
  color: #5f6368;
  flex-shrink: 0;
}
/* Match React's ToolbarGroup `border-r border-slate-200/50` between
   button groups (Toolbar wraps each group in a `<ToolbarGroup>`
   that ends with a 1px slate-200/50 right border). The vertical line
   sits centered with 6px breathing room on each side, matching the
   `px-1.5` padding React puts on every group. */
.divider {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: rgba(226, 232, 240, 0.5);
  flex-shrink: 0;
}
/* Editing-mode chip inside the slate pill — match the slate text
   color and minimal-height the chip so it doesn't break the pill
   alignment. */
.basic-toolbar :deep(.editing-mode__trigger) {
  height: 28px;
  background: transparent;
  color: #475569;
}
.basic-toolbar :deep(.editing-mode__trigger:hover),
.basic-toolbar :deep(.editing-mode__trigger--open) {
  background: rgba(15, 23, 42, 0.06);
  color: #0f172a;
}

/* Dropdown system */
.toolbar-dropdown {
  position: relative;
  display: flex;
  align-items: center;
}
.toolbar-dropdown__trigger {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: #334155;
  white-space: nowrap;
}
.toolbar-dropdown__trigger:hover {
  background: #f1f5f9;
  border-color: #e2e8f0;
}
.chevron {
  font-size: 10px;
  color: #94a3b8;
}
.toolbar-dropdown__menu {
  position: fixed;
  z-index: 10000;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  max-height: 320px;
  overflow-y: auto;
  min-width: 120px;
  padding: 4px 0;
}
.toolbar-dropdown__item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: #1f2937;
  white-space: nowrap;
}
.toolbar-dropdown__item:hover {
  background: #f3f4f6;
}
.toolbar-dropdown__item.active {
  background: #e0e7ff;
  color: #3730a3;
}
.toolbar-dropdown__group-label {
  padding: 4px 12px 2px;
  font-size: 10px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Style picker */
.style-trigger {
  min-width: 90px;
}
.style-menu {
  min-width: 160px;
}

/* Font picker */
.font-trigger {
  min-width: 100px;
}
.font-menu {
  min-width: 180px;
}

/* Font size */
.font-size-group {
  display: flex;
  align-items: center;
  gap: 0;
}
.size-btn {
  width: 22px !important;
  height: 22px !important;
  min-width: 22px !important;
  font-size: 14px !important;
  border: 1px solid #e2e8f0 !important;
  border-radius: 3px !important;
  padding: 0 !important;
  line-height: 1;
}
.size-trigger {
  width: 36px;
  text-align: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
}
.size-menu {
  min-width: 60px;
}
.size-menu .toolbar-dropdown__item {
  text-align: center;
}

/* Zoom control */
.zoom-group {
  display: flex;
  align-items: center;
  gap: 0;
}
.zoom-trigger {
  width: 48px;
  text-align: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}
.zoom-menu {
  min-width: 80px;
}
.zoom-menu .toolbar-dropdown__item {
  text-align: center;
}
</style>
