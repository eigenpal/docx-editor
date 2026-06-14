<!--
  Vue port of packages/react/src/components/ui/ColorPicker.tsx —
  Word-style split-button color picker (apply | arrow) with the same
  dropdown layout: Automatic / No-color · Theme colors matrix (10×6
  tint/shade grid resolved against the document theme) · Standard
  colors row · Custom hex input.

  Theme-matrix generation and color resolution come from
  @eigenpal/docx-editor-core/utils so React and Vue stay in lockstep.
-->
<template>
  <div ref="containerRef" class="docx-color-picker" :class="className" :style="style">
    <!-- Split button: [apply | arrow] -->
    <div v-if="splitButton" class="docx-color-picker__split" :class="{ 'is-disabled': disabled }">
      <button
        type="button"
        class="docx-color-picker__apply"
        :disabled="disabled"
        :title="title ?? defaultTitle"
        :aria-label="title ?? defaultTitle"
        @mousedown.prevent
        @click="applyLast"
      >
        <MaterialSymbol :name="resolvedIcon" :size="18" />
        <span
          class="docx-color-picker__bar"
          :class="{ 'is-light': swatchColor === 'transparent' || isLightColor(swatchColor) }"
          :style="{ background: swatchColor === 'transparent' ? '#fff' : swatchColor }"
        />
      </button>
      <button
        type="button"
        class="docx-color-picker__arrow"
        :class="{ 'is-open': isOpen }"
        :disabled="disabled"
        :title="title ?? defaultTitle"
        :aria-label="title ?? defaultTitle"
        aria-haspopup="true"
        :aria-expanded="isOpen"
        @mousedown.prevent
        @click="toggle"
      >
        <MaterialSymbol name="arrow_drop_down" :size="18" />
      </button>
    </div>

    <!-- Legacy single button -->
    <button
      v-else
      type="button"
      class="docx-color-picker__button"
      :class="{ 'is-open': isOpen }"
      :disabled="disabled"
      :title="title ?? defaultTitle"
      :aria-label="title ?? defaultTitle"
      aria-haspopup="true"
      :aria-expanded="isOpen"
      @mousedown.prevent
      @click="toggle"
    >
      <span class="docx-color-picker__button-stack">
        <MaterialSymbol :name="resolvedIcon" :size="18" />
        <span
          class="docx-color-picker__bar"
          :class="{ 'is-light': resolvedColor === 'transparent' || isLightColor(resolvedColor) }"
          :style="{ background: resolvedColor === 'transparent' ? '#fff' : resolvedColor }"
        />
      </span>
      <MaterialSymbol name="arrow_drop_down" :size="14" />
    </button>

    <!-- Dropdown panel -->
    <div
      v-if="isOpen && !disabled"
      ref="panelRef"
      class="docx-color-picker__panel"
      :style="panelStyle"
      role="dialog"
      :aria-label="t('colorPicker.ariaLabel', { type: defaultTitle })"
      @mousedown="onPanelMouseDown"
    >
      <button
        type="button"
        class="docx-color-picker__auto"
        @mousedown.prevent
        @click="pickAutomatic"
      >
        <span
          v-if="mode === 'highlight'"
          class="docx-color-picker__auto-icon docx-color-picker__auto-icon--none"
        >
          <span class="docx-color-picker__auto-slash" />
        </span>
        <span v-else class="docx-color-picker__auto-icon docx-color-picker__auto-icon--auto" />
        {{
          autoLabel ??
          (mode === 'highlight' ? t('colorPicker.noColor') : t('colorPicker.automatic'))
        }}
      </button>

      <div class="docx-color-picker__divider" />
      <div class="docx-color-picker__section-label">{{ t('colorPicker.themeColors') }}</div>
      <div class="docx-color-picker__grid">
        <button
          v-for="cell in flatMatrix"
          :key="cell.key"
          type="button"
          class="docx-color-picker__cell"
          :class="{ 'is-selected': isSelectedCell(value, cell.hex) }"
          :style="{ background: '#' + cell.hex }"
          :title="cell.label"
          :aria-label="cell.label"
          :aria-selected="isSelectedCell(value, cell.hex)"
          @mousedown.prevent
          @click="pickThemeCell(cell)"
        />
      </div>

      <div class="docx-color-picker__divider" />
      <div class="docx-color-picker__section-label">{{ t('colorPicker.standardColors') }}</div>
      <div class="docx-color-picker__grid">
        <button
          v-for="c in STANDARD_COLORS"
          :key="c.hex"
          type="button"
          class="docx-color-picker__cell"
          :class="{ 'is-selected': isSelectedCell(value, c.hex) }"
          :style="{ background: '#' + c.hex }"
          :title="t(c.nameKey)"
          :aria-label="t(c.nameKey)"
          :aria-selected="isSelectedCell(value, c.hex)"
          @mousedown.prevent
          @click="pickStandard(c.hex)"
        />
      </div>

      <div class="docx-color-picker__divider" />
      <div class="docx-color-picker__section-label">{{ t('colorPicker.customColor') }}</div>
      <div class="docx-color-picker__custom">
        <span class="docx-color-picker__hash">#</span>
        <input
          v-model="customHex"
          type="text"
          class="docx-color-picker__hex"
          placeholder="FF0000"
          maxlength="6"
          aria-label="Custom hex color"
          @input="customHex = customHex.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6)"
          @keydown.enter.prevent="applyCustom"
          @mousedown.stop
        />
        <button
          type="button"
          class="docx-color-picker__apply-btn"
          :disabled="!isValidHex(customHex)"
          @mousedown.prevent
          @click="applyCustom"
        >
          {{ t('common.apply') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, type CSSProperties } from 'vue';
import type { ColorValue, Theme } from '@eigenpal/docx-editor-core/types/document';
import {
  generateThemeTintShadeMatrix,
  resolveColor,
  resolveColorToHex,
  resolveHighlightColor,
  type ThemeMatrixCell,
} from '@eigenpal/docx-editor-core/utils';
import MaterialSymbol from './MaterialSymbol.vue';
import { useTranslation } from '../../i18n';

export type ColorPickerMode = 'text' | 'highlight' | 'border';

const props = withDefaults(
  defineProps<{
    mode: ColorPickerMode;
    value?: ColorValue | string;
    theme?: Theme | null;
    disabled?: boolean;
    className?: string;
    style?: CSSProperties;
    title?: string;
    /** Override the default icon for the mode */
    icon?: string;
    /** Override the auto/no-color button label */
    autoLabel?: string;
    /** Word-style split button (apply | arrow). Default true. */
    splitButton?: boolean;
    /** Initial "last picked" color used by the apply half. */
    defaultColor?: ColorValue | string;
  }>(),
  { disabled: false, splitButton: true }
);

const emit = defineEmits<{
  (e: 'change', color: ColorValue | string): void;
}>();

const { t } = useTranslation();

const STANDARD_COLORS: Array<{ nameKey: string; hex: string }> = [
  { nameKey: 'colorPicker.colors.darkRed', hex: 'C00000' },
  { nameKey: 'colorPicker.colors.red', hex: 'FF0000' },
  { nameKey: 'colorPicker.colors.orange', hex: 'FFC000' },
  { nameKey: 'colorPicker.colors.yellow', hex: 'FFFF00' },
  { nameKey: 'colorPicker.colors.lightGreen', hex: '92D050' },
  { nameKey: 'colorPicker.colors.green', hex: '00B050' },
  { nameKey: 'colorPicker.colors.lightBlue', hex: '00B0F0' },
  { nameKey: 'colorPicker.colors.blue', hex: '0070C0' },
  { nameKey: 'colorPicker.colors.darkBlue', hex: '002060' },
  { nameKey: 'colorPicker.colors.purple', hex: '7030A0' },
];

// ── Color resolution helpers (mirror ColorPicker.tsx) ───────────────────────

function resolveCurrentColor(value: ColorValue | string | undefined): string {
  if (!value) {
    return props.mode === 'text' || props.mode === 'border' ? '#000000' : 'transparent';
  }
  if (typeof value === 'string') {
    if (props.mode === 'highlight') {
      const resolved = resolveHighlightColor(value);
      if (resolved) return resolved;
      if (value === 'none') return 'transparent';
      return value.startsWith('#') ? value : `#${value}`;
    }
    return value.startsWith('#') ? value : `#${value}`;
  }
  return resolveColor(value, props.theme);
}

function isValidHex(hex: string): boolean {
  return /^[0-9A-Fa-f]{6}$/.test(hex.replace(/^#/, ''));
}

function isLightColor(hex: string): boolean {
  const h = hex.replace(/^#/, '');
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 230;
}

function isSelectedCell(value: ColorValue | string | undefined, cellHex: string): boolean {
  if (!value) return false;
  const resolved =
    typeof value === 'string'
      ? value.replace(/^#/, '').toUpperCase()
      : resolveColorToHex(value, props.theme);
  return resolved === cellHex.toUpperCase();
}

// ── Reactive state ──────────────────────────────────────────────────────────

const isOpen = ref(false);
const customHex = ref('');
const containerRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);

// Word-style "last picked" color used by the apply half — red for text,
// yellow for highlight, black for border until the user picks something.
const pickedColor = ref<ColorValue | string>(
  props.defaultColor ??
    (props.mode === 'highlight'
      ? 'FFFF00'
      : props.mode === 'border'
        ? { rgb: '000000' }
        : { rgb: 'FF0000' })
);

const matrix = computed(() => generateThemeTintShadeMatrix(props.theme?.colorScheme ?? null));
const flatMatrix = computed(() =>
  matrix.value.flatMap((row, ri) => row.map((cell, ci) => ({ ...cell, key: `${ri}-${ci}` })))
);

const resolvedColor = computed(() => resolveCurrentColor(props.value));
const swatchColor = computed(() => resolveCurrentColor(pickedColor.value));

const defaultTitle = computed(() =>
  props.mode === 'text'
    ? t('formattingBar.fontColor')
    : props.mode === 'highlight'
      ? t('formattingBar.highlightColor')
      : t('table.borderColor')
);

const resolvedIcon = computed(
  () =>
    props.icon ??
    (props.mode === 'text'
      ? 'format_color_text'
      : props.mode === 'highlight'
        ? 'ink_highlighter'
        : 'border_color')
);

// Keep the custom-hex input in sync with the current value.
watch(
  () => [props.value, props.mode, props.theme] as const,
  () => {
    const hex = resolveCurrentColor(props.value).replace(/^#/, '');
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) customHex.value = hex.toUpperCase();
  },
  { immediate: true }
);

// ── Panel positioning (position: fixed so it escapes overflow-clipped toolbars) ──

const panelStyle = ref<CSSProperties>({});
function recomputePanelPos() {
  const el = containerRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  panelStyle.value = { top: `${rect.bottom + 4}px`, left: `${rect.left}px` };
}

function toggle() {
  if (props.disabled) return;
  if (!isOpen.value) recomputePanelPos();
  isOpen.value = !isOpen.value;
}

// ── Selection handlers ──────────────────────────────────────────────────────

function emitAndClose(color: ColorValue | string, remember = true) {
  if (remember) pickedColor.value = color;
  emit('change', color);
  isOpen.value = false;
}

function applyLast() {
  if (props.disabled) return;
  emit('change', pickedColor.value);
}

function pickThemeCell(cell: ThemeMatrixCell) {
  if (props.mode === 'highlight') {
    emitAndClose(cell.hex);
    return;
  }
  const colorValue: ColorValue = { themeColor: cell.themeSlot, rgb: cell.hex };
  if (cell.tint) colorValue.themeTint = cell.tint;
  if (cell.shade) colorValue.themeShade = cell.shade;
  emitAndClose(colorValue);
}

function pickStandard(hex: string) {
  emitAndClose(props.mode === 'highlight' ? hex : { rgb: hex });
}

// Auto / no-color isn't a "color choice" the apply half should remember.
function pickAutomatic() {
  emitAndClose(props.mode === 'highlight' ? 'none' : { auto: true }, false);
}

function applyCustom() {
  const hex = customHex.value.replace(/^#/, '').toUpperCase();
  if (!isValidHex(hex)) return;
  emitAndClose(props.mode === 'highlight' ? hex : { rgb: hex });
  customHex.value = '';
}

function onPanelMouseDown(e: MouseEvent) {
  // Let the hex input focus; block focus-steal for everything else.
  if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault();
}

// ── Click-outside ───────────────────────────────────────────────────────────

function onClickOutside(e: MouseEvent) {
  if (!isOpen.value) return;
  const target = e.target as Node;
  if (containerRef.value?.contains(target)) return;
  if (panelRef.value?.contains(target)) return;
  isOpen.value = false;
}
onMounted(() => document.addEventListener('mousedown', onClickOutside));
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside));
</script>

<style scoped>
.docx-color-picker {
  position: relative;
  display: inline-block;
}

/* ── Split button ── */
.docx-color-picker__split {
  display: inline-flex;
  align-items: stretch;
  height: 32px;
  gap: 2px;
}
.docx-color-picker__split.is-disabled {
  opacity: 0.38;
  cursor: default;
}
.docx-color-picker__apply,
.docx-color-picker__arrow,
.docx-color-picker__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--doc-text-muted);
  cursor: pointer;
  padding: 0;
  transition: background-color 0.1s;
}
.docx-color-picker__apply {
  flex-direction: column;
  gap: 0;
  width: 28px;
  padding: 2px 4px;
}
.docx-color-picker__arrow {
  width: 18px;
}
.docx-color-picker__button {
  width: 40px;
  height: 32px;
  padding: 2px 6px;
}
.docx-color-picker__button-stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}
.docx-color-picker__apply:hover:not(:disabled),
.docx-color-picker__arrow:hover:not(:disabled),
.docx-color-picker__button:hover:not(:disabled) {
  background: var(--doc-bg-hover);
}
.docx-color-picker__arrow.is-open,
.docx-color-picker__button.is-open {
  background: var(--doc-primary-light);
  color: var(--doc-primary);
}
.docx-color-picker__apply:disabled,
.docx-color-picker__arrow:disabled,
.docx-color-picker__button:disabled {
  cursor: default;
}
.docx-color-picker__bar {
  display: block;
  width: 16px;
  height: 4px;
  border-radius: 1px;
  margin-top: -2px;
}
.docx-color-picker__bar.is-light {
  outline: 1px solid var(--doc-border-input);
}

/* ── Dropdown panel ── */
.docx-color-picker__panel {
  position: fixed;
  z-index: 10000;
  padding: 10px;
  background: var(--doc-surface);
  border: 1px solid var(--doc-border-dark);
  border-radius: 6px;
  box-shadow: 0 4px 16px var(--doc-shadow);
  width: auto;
}
.docx-color-picker__auto {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  background: var(--doc-surface);
  font-size: 12px;
  color: var(--doc-text);
  cursor: pointer;
}
.docx-color-picker__auto:hover {
  background: var(--doc-bg-subtle);
}
.docx-color-picker__auto-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: 2px;
}
.docx-color-picker__auto-icon--auto {
  background: #000;
}
.docx-color-picker__auto-icon--none {
  position: relative;
  border: 1px solid #ccc;
  background: #fff;
}
.docx-color-picker__auto-slash {
  position: absolute;
  top: 50%;
  left: -1px;
  right: -1px;
  height: 2px;
  background: #ff0000;
  transform: rotate(-45deg);
}
.docx-color-picker__divider {
  height: 1px;
  background: var(--doc-border);
  margin: 8px 0;
}
.docx-color-picker__section-label {
  font-size: 11px;
  color: var(--doc-text-muted);
  margin-bottom: 4px;
  font-weight: 500;
}
.docx-color-picker__grid {
  display: grid;
  grid-template-columns: repeat(10, 18px);
  gap: 2px;
}
.docx-color-picker__cell {
  width: 18px;
  height: 18px;
  border: 1px solid var(--doc-border-input);
  border-radius: 2px;
  padding: 0;
  cursor: pointer;
  transition:
    transform 0.1s,
    border-color 0.1s;
}
.docx-color-picker__cell:hover {
  transform: scale(1.15);
  border-color: var(--doc-text);
  z-index: 1;
}
.docx-color-picker__cell.is-selected {
  border-width: 2px;
  border-color: var(--doc-primary);
  box-shadow: 0 0 0 1px var(--doc-primary);
}
.docx-color-picker__custom {
  display: flex;
  align-items: center;
  gap: 6px;
}
.docx-color-picker__hash {
  font-size: 12px;
  color: var(--doc-text-muted);
}
.docx-color-picker__hex {
  width: 70px;
  height: 24px;
  padding: 2px 6px;
  border: 1px solid var(--doc-border-input);
  border-radius: 3px;
  font-size: 12px;
}
.docx-color-picker__apply-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--doc-border-input);
  border-radius: 3px;
  background: var(--doc-bg-subtle);
  font-size: 12px;
  cursor: pointer;
}
.docx-color-picker__apply-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
