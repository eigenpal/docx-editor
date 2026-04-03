<template>
  <div class="basic-toolbar" v-if="view">
    <!-- Paragraph Style Picker -->
    <div class="toolbar-dropdown" ref="styleDropdownRef">
      <button
        class="toolbar-dropdown__trigger style-trigger"
        @mousedown.prevent="toggleDropdown('style')"
        :title="'Paragraph style'"
      >
        {{ currentStyleLabel }}
        <span class="chevron">▾</span>
      </button>
      <div v-if="openDropdown === 'style'" class="toolbar-dropdown__menu style-menu">
        <button
          v-for="s in paragraphStyles"
          :key="s.id"
          class="toolbar-dropdown__item"
          :class="{ active: ctx.paragraphFormatting.styleId === s.id }"
          :style="s.previewStyle"
          @mousedown.prevent="handleApplyStyle(s.id)"
        >{{ s.label }}</button>
      </div>
    </div>

    <span class="divider" />

    <!-- Font Family Picker -->
    <div class="toolbar-dropdown" ref="fontDropdownRef">
      <button
        class="toolbar-dropdown__trigger font-trigger"
        @mousedown.prevent="toggleDropdown('font')"
        title="Font family"
      >
        {{ currentFontFamily }}
        <span class="chevron">▾</span>
      </button>
      <div v-if="openDropdown === 'font'" class="toolbar-dropdown__menu font-menu">
        <div class="toolbar-dropdown__group-label">Sans-serif</div>
        <button v-for="f in fontsSansSerif" :key="f" class="toolbar-dropdown__item" :style="{ fontFamily: f }" @mousedown.prevent="setFont(f)">{{ f }}</button>
        <div class="toolbar-dropdown__group-label">Serif</div>
        <button v-for="f in fontsSerif" :key="f" class="toolbar-dropdown__item" :style="{ fontFamily: f }" @mousedown.prevent="setFont(f)">{{ f }}</button>
        <div class="toolbar-dropdown__group-label">Monospace</div>
        <button v-for="f in fontsMono" :key="f" class="toolbar-dropdown__item" :style="{ fontFamily: f }" @mousedown.prevent="setFont(f)">{{ f }}</button>
      </div>
    </div>

    <!-- Font Size Picker -->
    <div class="toolbar-dropdown font-size-group" ref="sizeDropdownRef">
      <button class="size-btn" @mousedown.prevent="decreaseFontSize" title="Decrease font size">−</button>
      <button
        class="toolbar-dropdown__trigger size-trigger"
        @mousedown.prevent="toggleDropdown('size')"
        title="Font size"
      >{{ currentFontSize }}</button>
      <button class="size-btn" @mousedown.prevent="increaseFontSize" title="Increase font size">+</button>
      <div v-if="openDropdown === 'size'" class="toolbar-dropdown__menu size-menu">
        <button
          v-for="s in fontSizePresets"
          :key="s"
          class="toolbar-dropdown__item"
          :class="{ active: currentFontSize === s }"
          @mousedown.prevent="setFontSize(s)"
        >{{ s }}</button>
      </div>
    </div>

    <span class="divider" />

    <!-- Text Formatting -->
    <button title="Bold (Ctrl+B)" :class="{ active: ctx.textFormatting.bold }" @mousedown.prevent="execCommand('toggleBold')"><b>B</b></button>
    <button title="Italic (Ctrl+I)" :class="{ active: ctx.textFormatting.italic }" @mousedown.prevent="execCommand('toggleItalic')"><i>I</i></button>
    <button title="Underline (Ctrl+U)" :class="{ active: !!ctx.textFormatting.underline }" @mousedown.prevent="execCommand('toggleUnderline')"><u>U</u></button>
    <button title="Strikethrough" :class="{ active: ctx.textFormatting.strike }" @mousedown.prevent="execCommand('toggleStrike')"><s>S</s></button>
    <button title="Superscript (Ctrl+Shift+=)" :class="{ active: ctx.textFormatting.vertAlign === 'superscript' }" @mousedown.prevent="execCommand('toggleSuperscript')">X²</button>
    <button title="Subscript (Ctrl+=)" :class="{ active: ctx.textFormatting.vertAlign === 'subscript' }" @mousedown.prevent="execCommand('toggleSubscript')">X₂</button>

    <span class="divider" />

    <!-- Text Color -->
    <div class="toolbar-dropdown" ref="colorDropdownRef">
      <button
        class="color-btn"
        @mousedown.prevent="toggleDropdown('color')"
        title="Text color"
      >
        A
        <span class="color-bar" :style="{ background: currentTextColor }"></span>
      </button>
      <div v-if="openDropdown === 'color'" class="toolbar-dropdown__menu color-menu">
        <button class="toolbar-dropdown__item" @mousedown.prevent="setTextColor('')">Automatic</button>
        <div class="color-grid">
          <button
            v-for="c in standardColors"
            :key="c.hex"
            class="color-swatch"
            :style="{ background: '#' + c.hex }"
            :title="c.name"
            @mousedown.prevent="setTextColor(c.hex)"
          ></button>
        </div>
        <div class="color-custom">
          <input
            v-model="customColor"
            class="color-input"
            placeholder="Hex (e.g. FF0000)"
            @keydown.enter.prevent="setTextColor(customColor)"
          />
          <button class="color-apply" @mousedown.prevent="setTextColor(customColor)">Apply</button>
        </div>
      </div>
    </div>

    <!-- Highlight Color -->
    <div class="toolbar-dropdown" ref="highlightDropdownRef">
      <button
        class="color-btn"
        @mousedown.prevent="toggleDropdown('highlight')"
        title="Highlight color"
      >
        <span class="highlight-icon" :style="{ background: currentHighlightColor }">A</span>
      </button>
      <div v-if="openDropdown === 'highlight'" class="toolbar-dropdown__menu color-menu">
        <button class="toolbar-dropdown__item" @mousedown.prevent="setHighlight('none')">No Color</button>
        <div class="color-grid">
          <button
            v-for="c in highlightColors"
            :key="c.hex"
            class="color-swatch"
            :style="{ background: '#' + c.hex }"
            :title="c.name"
            @mousedown.prevent="setHighlight(c.hex)"
          ></button>
        </div>
      </div>
    </div>

    <span class="divider" />

    <!-- Alignment -->
    <button title="Align Left (Ctrl+L)" :class="{ active: currentAlignment === 'left' }" @mousedown.prevent="execCommand('alignLeft')">⇤</button>
    <button title="Align Center (Ctrl+E)" :class="{ active: currentAlignment === 'center' }" @mousedown.prevent="execCommand('alignCenter')">⇔</button>
    <button title="Align Right (Ctrl+R)" :class="{ active: currentAlignment === 'right' }" @mousedown.prevent="execCommand('alignRight')">⇥</button>
    <button title="Justify (Ctrl+J)" :class="{ active: currentAlignment === 'both' }" @mousedown.prevent="execCommand('alignJustify')">☰</button>

    <span class="divider" />

    <!-- Lists -->
    <button title="Bullet List" :class="{ active: ctx.inList && ctx.listType === 'bullet' }" @mousedown.prevent="execCommand('toggleBulletList')">•≡</button>
    <button title="Numbered List" :class="{ active: ctx.inList && ctx.listType === 'numbered' }" @mousedown.prevent="execCommand('toggleNumberedList')">1≡</button>
    <button title="Decrease Indent (Shift+Tab)" @mousedown.prevent="execCommand('outdent')">⇤≡</button>
    <button title="Increase Indent (Tab)" @mousedown.prevent="execCommand('indent')">≡⇥</button>

    <span class="divider" />

    <!-- Line Spacing -->
    <div class="toolbar-dropdown" ref="spacingDropdownRef">
      <button
        class="toolbar-dropdown__trigger"
        @mousedown.prevent="toggleDropdown('spacing')"
        title="Line spacing"
        style="width: auto; padding: 0 6px;"
      >
        ↕
        <span class="chevron">▾</span>
      </button>
      <div v-if="openDropdown === 'spacing'" class="toolbar-dropdown__menu">
        <button
          v-for="sp in lineSpacingOptions"
          :key="sp.value"
          class="toolbar-dropdown__item"
          :class="{ active: isCurrentLineSpacing(sp.value) }"
          @mousedown.prevent="setLineSpacing(sp.value)"
        >{{ sp.label }}</button>
      </div>
    </div>

    <span class="divider" />

    <!-- Clear Formatting -->
    <button title="Clear formatting" @mousedown.prevent="handleClearFormatting">Tₓ</button>

    <!-- Undo / Redo -->
    <span class="divider" />
    <button title="Undo (Ctrl+Z)" @mousedown.prevent="execCommand('undo')">↶</button>
    <button title="Redo (Ctrl+Y)" @mousedown.prevent="execCommand('redo')">↷</button>

    <!-- Find & Replace -->
    <span class="divider" />
    <button title="Find & Replace (Ctrl+H)" @mousedown.prevent="$emit('find-replace')">🔍</button>

    <!-- Insert menu -->
    <span class="divider" />
    <div class="toolbar-dropdown" ref="insertDropdownRef">
      <button
        class="toolbar-dropdown__trigger"
        @mousedown.prevent="toggleDropdown('insert')"
        title="Insert"
        style="width: auto; padding: 0 8px; font-weight: 500;"
      >
        Insert
        <span class="chevron">▾</span>
      </button>
      <div v-if="openDropdown === 'insert'" class="toolbar-dropdown__menu" style="min-width: 160px;">
        <button class="toolbar-dropdown__item" @mousedown.prevent="$emit('insert-table')">📊 Table...</button>
        <button class="toolbar-dropdown__item" @mousedown.prevent="$emit('insert-image')">🖼️ Image...</button>
        <button class="toolbar-dropdown__item" @mousedown.prevent="$emit('insert-link')">🔗 Link... (Ctrl+K)</button>
        <button class="toolbar-dropdown__item" @mousedown.prevent="$emit('insert-symbol')">Ω Symbol...</button>
        <div style="height:1px; background:#e5e7eb; margin:4px 0;"></div>
        <button class="toolbar-dropdown__item" @mousedown.prevent="$emit('insert-page-break')">⏎ Page break</button>
        <button class="toolbar-dropdown__item" @mousedown.prevent="$emit('insert-toc')">📑 Table of Contents</button>
        <div style="height:1px; background:#e5e7eb; margin:4px 0;"></div>
        <button class="toolbar-dropdown__item" @mousedown.prevent="$emit('page-setup')">⚙ Page setup...</button>
      </div>
    </div>

    <!-- Document Outline toggle -->
    <span class="divider" />
    <button title="Document Outline" @mousedown.prevent="$emit('toggle-outline')">≡</button>

    <!-- Comments / Changes sidebar toggle -->
    <button title="Comments & Changes" @mousedown.prevent="$emit('toggle-sidebar')">💬</button>

    <!-- Zoom Control -->
    <span class="divider" />
    <div class="toolbar-dropdown zoom-group" ref="zoomDropdownRef">
      <button class="size-btn" @mousedown.prevent="$emit('zoom-out')" :disabled="isMinZoom" title="Zoom out">−</button>
      <button
        class="toolbar-dropdown__trigger zoom-trigger"
        @mousedown.prevent="toggleDropdown('zoom')"
        title="Zoom level"
      >{{ zoomPercent }}%</button>
      <button class="size-btn" @mousedown.prevent="$emit('zoom-in')" :disabled="isMaxZoom" title="Zoom in">+</button>
      <div v-if="openDropdown === 'zoom'" class="toolbar-dropdown__menu zoom-menu">
        <button
          v-for="p in zoomPresets"
          :key="p"
          class="toolbar-dropdown__item"
          :class="{ active: zoomPercent === Math.round(p * 100) }"
          @mousedown.prevent="$emit('zoom-set', p)"
        >{{ Math.round(p * 100) }}%</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { extractSelectionContext } from '@eigenpal/docx-core/prosemirror/plugins/selectionTracker';
import { clearFormatting } from '@eigenpal/docx-core/prosemirror/commands/formatting';
import type { SelectionContext } from '@eigenpal/docx-core/prosemirror/plugins/selectionTracker';

const props = defineProps<{
  view: EditorView | null;
  getCommands: () => Record<string, (...args: any[]) => any>;
  stateTick: number;
  cursorMarks: { name: string; attrs: Record<string, any> }[];
  zoomPercent?: number;
  isMinZoom?: boolean;
  isMaxZoom?: boolean;
  zoomPresets?: number[];
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
}>();

// =========================================================================
// Dropdown state
// =========================================================================

const zoomPercent = computed(() => props.zoomPercent ?? 100);
const isMinZoom = computed(() => props.isMinZoom ?? false);
const isMaxZoom = computed(() => props.isMaxZoom ?? false);
const zoomPresets = computed(() => props.zoomPresets ?? [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]);

const openDropdown = ref<string | null>(null);
const styleDropdownRef = ref<HTMLElement | null>(null);
const fontDropdownRef = ref<HTMLElement | null>(null);
const sizeDropdownRef = ref<HTMLElement | null>(null);
const colorDropdownRef = ref<HTMLElement | null>(null);
const highlightDropdownRef = ref<HTMLElement | null>(null);
const spacingDropdownRef = ref<HTMLElement | null>(null);
const insertDropdownRef = ref<HTMLElement | null>(null);
const zoomDropdownRef = ref<HTMLElement | null>(null);
const customColor = ref('');

function toggleDropdown(name: string) {
  openDropdown.value = openDropdown.value === name ? null : name;
}

function closeDropdowns(e: MouseEvent) {
  const refs = [styleDropdownRef, fontDropdownRef, sizeDropdownRef, colorDropdownRef, highlightDropdownRef, spacingDropdownRef, insertDropdownRef, zoomDropdownRef];
  const target = e.target as Node;
  if (!refs.some(r => r.value?.contains(target))) {
    openDropdown.value = null;
  }
}

onMounted(() => document.addEventListener('mousedown', closeDropdowns));
onBeforeUnmount(() => document.removeEventListener('mousedown', closeDropdowns));

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

/**
 * Local snapshot of marks at cursor/selection start.
 * Updated via two paths:
 *  1. watch on stateTick (for selection changes by user interaction)
 *  2. snapshotMarks() called directly in execCommand (for toolbar-driven commands)
 */
const marksTick = ref(0);

/** Read marks directly from the EditorView state */
function snapshotMarks() {
  marksTick.value++;
}

/** Read a mark attribute from the current ProseMirror state */
function readMarkAttr(markName: string, attr: string): unknown {
  const v = props.view;
  if (!v) return undefined;
  const { state } = v;
  const marks = getMarksFromState(state);
  for (const mark of marks) {
    if (mark.type.name === markName) return mark.attrs[attr];
  }
  return undefined;
}

/** Get marks at the cursor/selection start, handling text node boundaries correctly */
function getMarksFromState(state: any): readonly any[] {
  if (state.storedMarks) return state.storedMarks;
  const { from, to, empty } = state.selection;
  if (empty) return state.selection.$from.marks();
  // For non-empty selection, read marks from the first text node in the range
  // ($from.marks() at a boundary can return marks from the node BEFORE the selection)
  let marks: readonly any[] = [];
  state.doc.nodesBetween(from, Math.min(from + 1, to), (node: any) => {
    if (node.isText) {
      marks = node.marks;
      return false;
    }
  });
  return marks.length ? marks : state.selection.$from.marks();
}

// When the parent signals a state change, bump our local tick too
watch(() => props.stateTick, () => { marksTick.value++; });

const currentFontFamily = computed(() => {
  void marksTick.value;
  const ascii = readMarkAttr('fontFamily', 'ascii') as string | undefined;
  const hAnsi = readMarkAttr('fontFamily', 'hAnsi') as string | undefined;
  return ascii || hAnsi || 'Arial';
});

const currentFontSize = computed(() => {
  void marksTick.value;
  const sz = readMarkAttr('fontSize', 'size') as number | undefined;
  return sz ? sz / 2 : 11; // half-points to points
});

const currentTextColor = computed(() => {
  void marksTick.value;
  const rgb = readMarkAttr('textColor', 'rgb') as string | undefined;
  return rgb ? '#' + rgb : '#000000';
});

const currentHighlightColor = computed(() => {
  void marksTick.value;
  const h = readMarkAttr('highlight', 'color') as string | undefined;
  return h && h !== 'none' ? '#' + h : 'transparent';
});

const currentAlignment = computed(() => {
  return ctx.value.paragraphFormatting.alignment || 'left';
});

const currentStyleLabel = computed(() => {
  const id = ctx.value.paragraphFormatting.styleId || 'Normal';
  const s = paragraphStyles.find(ps => ps.id === id);
  return s?.label || id;
});

// =========================================================================
// Constants
// =========================================================================

const fontsSansSerif = ['Arial', 'Calibri', 'Helvetica', 'Verdana', 'Open Sans', 'Roboto'];
const fontsSerif = ['Times New Roman', 'Georgia', 'Cambria', 'Garamond'];
const fontsMono = ['Courier New', 'Consolas'];

const fontSizePresets = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

const standardColors = [
  { name: 'Dark Red', hex: 'C00000' },
  { name: 'Red', hex: 'FF0000' },
  { name: 'Orange', hex: 'FFC000' },
  { name: 'Yellow', hex: 'FFFF00' },
  { name: 'Light Green', hex: '92D050' },
  { name: 'Green', hex: '00B050' },
  { name: 'Light Blue', hex: '00B0F0' },
  { name: 'Blue', hex: '0070C0' },
  { name: 'Dark Blue', hex: '002060' },
  { name: 'Purple', hex: '7030A0' },
];

const highlightColors = [
  { name: 'Yellow', hex: 'FFFF00' },
  { name: 'Bright Green', hex: '00FF00' },
  { name: 'Cyan', hex: '00FFFF' },
  { name: 'Magenta', hex: 'FF00FF' },
  { name: 'Blue', hex: '0000FF' },
  { name: 'Red', hex: 'FF0000' },
  { name: 'Dark Blue', hex: '000080' },
  { name: 'Teal', hex: '008080' },
  { name: 'Green', hex: '008000' },
  { name: 'Violet', hex: '800080' },
  { name: 'Dark Red', hex: '800000' },
  { name: 'Dark Yellow', hex: '808000' },
  { name: 'Gray 50%', hex: '808080' },
  { name: 'Gray 25%', hex: 'C0C0C0' },
  { name: 'Black', hex: '000000' },
];

const paragraphStyles = [
  { id: 'Normal', label: 'Normal', previewStyle: { fontSize: '13px' } },
  { id: 'Title', label: 'Title', previewStyle: { fontSize: '20px', fontWeight: 'bold' } },
  { id: 'Subtitle', label: 'Subtitle', previewStyle: { fontSize: '15px', color: '#6b7280' } },
  { id: 'Heading1', label: 'Heading 1', previewStyle: { fontSize: '18px', fontWeight: 'bold', color: '#4a6c8c' } },
  { id: 'Heading2', label: 'Heading 2', previewStyle: { fontSize: '16px', fontWeight: 'bold', color: '#4a6c8c' } },
  { id: 'Heading3', label: 'Heading 3', previewStyle: { fontSize: '14px', fontWeight: 'bold', color: '#4a6c8c' } },
];

const lineSpacingOptions = [
  { label: 'Single', value: 240 },
  { label: '1.15', value: 276 },
  { label: '1.5', value: 360 },
  { label: 'Double', value: 480 },
];

// =========================================================================
// Command helpers
// =========================================================================

function execCommand(name: string, ...args: any[]) {
  const v = props.view;
  if (!v) return;
  const cmds = props.getCommands();
  const cmdFactory = cmds[name];
  if (!cmdFactory) { console.warn('[Toolbar] command not found:', name); return; }
  const command = cmdFactory(...args);
  command(v.state, (tr: any) => v.dispatch(tr), v);
  // Immediately snapshot marks from the updated state so the toolbar
  // reflects the change before the next Vue render cycle.
  snapshotMarks();
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
  const next = fontSizePresets.find(s => s > current) || current + 2;
  setFontSize(next);
}

function decreaseFontSize() {
  const current = currentFontSize.value;
  const prev = [...fontSizePresets].reverse().find(s => s < current) || Math.max(1, current - 2);
  setFontSize(prev);
}

function setTextColor(hex: string) {
  if (!hex) {
    execCommand('clearTextColor');
  } else {
    execCommand('setTextColor', { rgb: hex });
  }
}

function handleClearFormatting() {
  const v = props.view;
  if (!v) return;
  clearFormatting(v.state, (tr: any) => v.dispatch(tr), v);
  snapshotMarks();
  if (!v.hasFocus()) v.focus();
}

function setHighlight(value: string) {
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
.basic-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  flex-wrap: wrap;
  min-height: 40px;
}
.basic-toolbar button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  padding: 0 4px;
  white-space: nowrap;
}
.basic-toolbar button:hover { background: #f1f5f9; }
.basic-toolbar button.active { background: #e2e8f0; color: #0f172a; }
.divider {
  width: 1px;
  height: 20px;
  background: #e2e8f0;
  margin: 0 2px;
  flex-shrink: 0;
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
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 200;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
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
.toolbar-dropdown__item:hover { background: #f3f4f6; }
.toolbar-dropdown__item.active { background: #e0e7ff; color: #3730a3; }
.toolbar-dropdown__group-label {
  padding: 4px 12px 2px;
  font-size: 10px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Style picker */
.style-trigger { min-width: 90px; }
.style-menu { min-width: 160px; }

/* Font picker */
.font-trigger { min-width: 100px; }
.font-menu { min-width: 180px; }

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
.size-menu { min-width: 60px; }
.size-menu .toolbar-dropdown__item { text-align: center; }

/* Color picker */
.color-btn {
  position: relative;
  width: 32px !important;
  font-size: 14px !important;
  font-weight: 700 !important;
}
.color-bar {
  position: absolute;
  bottom: 2px;
  left: 6px;
  right: 6px;
  height: 3px;
  border-radius: 1px;
}
.highlight-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 16px;
  font-size: 12px;
  font-weight: 700;
  border-radius: 2px;
  color: #000;
}
.color-menu { min-width: 200px; padding: 8px; }
.color-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 4px;
  padding: 6px 0;
}
.color-swatch {
  width: 28px !important;
  height: 28px !important;
  min-width: 28px !important;
  border: 1px solid #d1d5db !important;
  border-radius: 4px !important;
  cursor: pointer;
  padding: 0 !important;
}
.color-swatch:hover { border-color: #3b82f6 !important; box-shadow: 0 0 0 1px #3b82f6; }
.color-custom {
  display: flex;
  gap: 4px;
  padding-top: 6px;
  border-top: 1px solid #e5e7eb;
  margin-top: 4px;
}
.color-input {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 12px;
}
.color-apply {
  padding: 4px 8px !important;
  font-size: 11px !important;
  border: 1px solid #d1d5db !important;
  border-radius: 4px !important;
  min-width: auto !important;
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
.zoom-menu { min-width: 80px; }
.zoom-menu .toolbar-dropdown__item { text-align: center; }
</style>
