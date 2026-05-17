<!-- Page Setup dialog — mirrors packages/react/src/components/dialogs/PageSetupDialog.tsx. -->
<template>
  <div v-if="isOpen" class="ps-overlay" @mousedown.self="close" @keydown="onKeydown">
    <div class="ps-dialog" role="dialog" :aria-label="t('dialogs.pageSetup.title')" @mousedown.stop>
      <div class="ps-header">{{ t('dialogs.pageSetup.title') }}</div>

      <div class="ps-body">
        <!-- Page size -->
        <div class="ps-section-label">{{ t('dialogs.pageSetup.pageSize') }}</div>

        <div class="ps-row">
          <label class="ps-label">{{ t('dialogs.pageSetup.sizeLabel') }}</label>
          <select class="ps-input" :value="sizeIndex" @change="onPageSizeChange">
            <option v-for="(s, i) in PAGE_SIZES" :key="s.labelKey" :value="i">
              {{ t(s.labelKey) }}
            </option>
            <option v-if="sizeIndex < 0" :value="-1">{{ t('dialogs.pageSetup.custom') }}</option>
          </select>
        </div>

        <div class="ps-row">
          <label class="ps-label">{{ t('dialogs.pageSetup.orientation') }}</label>
          <select class="ps-input" :value="orientation" @change="onOrientationChange">
            <option value="portrait">{{ t('dialogs.pageSetup.portrait') }}</option>
            <option value="landscape">{{ t('dialogs.pageSetup.landscape') }}</option>
          </select>
        </div>

        <!-- Margins -->
        <div class="ps-section-label ps-section-label--spaced">
          {{ t('dialogs.pageSetup.margins') }}
        </div>

        <div class="ps-row">
          <label class="ps-label">{{ t('dialogs.pageSetup.top') }}</label>
          <input
            class="ps-input"
            type="number"
            min="0"
            max="10"
            step="0.1"
            v-model.number="marginTopIn"
          />
          <span class="ps-unit">in</span>
        </div>
        <div class="ps-row">
          <label class="ps-label">{{ t('dialogs.pageSetup.bottom') }}</label>
          <input
            class="ps-input"
            type="number"
            min="0"
            max="10"
            step="0.1"
            v-model.number="marginBottomIn"
          />
          <span class="ps-unit">in</span>
        </div>
        <div class="ps-row">
          <label class="ps-label">{{ t('dialogs.pageSetup.left') }}</label>
          <input
            class="ps-input"
            type="number"
            min="0"
            max="10"
            step="0.1"
            v-model.number="marginLeftIn"
          />
          <span class="ps-unit">in</span>
        </div>
        <div class="ps-row">
          <label class="ps-label">{{ t('dialogs.pageSetup.right') }}</label>
          <input
            class="ps-input"
            type="number"
            min="0"
            max="10"
            step="0.1"
            v-model.number="marginRightIn"
          />
          <span class="ps-unit">in</span>
        </div>
      </div>

      <div class="ps-footer">
        <button type="button" class="ps-btn" @click="close">{{ t('common.cancel') }}</button>
        <button type="button" class="ps-btn ps-btn--primary" @click="apply">
          {{ t('common.apply') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { SectionProperties } from '@eigenpal/docx-editor-core/types/document';
import { TWIPS_PER_INCH } from '@eigenpal/docx-editor-core/utils';
import { useTranslation } from '../../i18n';

const { t } = useTranslation();

// Default Word values (Letter, 1" margins).
const DEFAULT_WIDTH = 12240;
const DEFAULT_HEIGHT = 15840;
const DEFAULT_MARGIN = 1440;

/** Common page sizes in twips (width x height in portrait). Matches React. */
const PAGE_SIZES = [
  { labelKey: 'dialogs.pageSetup.pageSizes.letter', width: 12240, height: 15840 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a4', width: 11906, height: 16838 },
  { labelKey: 'dialogs.pageSetup.pageSizes.legal', width: 12240, height: 20160 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a3', width: 16838, height: 23811 },
  { labelKey: 'dialogs.pageSetup.pageSizes.a5', width: 8391, height: 11906 },
  { labelKey: 'dialogs.pageSetup.pageSizes.b5', width: 9979, height: 14175 },
  { labelKey: 'dialogs.pageSetup.pageSizes.executive', width: 10440, height: 15120 },
] as const;

const props = defineProps<{
  isOpen: boolean;
  sectionProperties?: SectionProperties | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'apply', props: Partial<SectionProperties>): void;
}>();

const pageWidth = ref(DEFAULT_WIDTH);
const pageHeight = ref(DEFAULT_HEIGHT);
const orientation = ref<'portrait' | 'landscape'>('portrait');
// Margins live in inches (the display unit); converted to/from twips at the load/apply boundaries.
const marginTopIn = ref(1);
const marginBottomIn = ref(1);
const marginLeftIn = ref(1);
const marginRightIn = ref(1);

function twipsToInches(twips: number): number {
  return Math.round((twips / TWIPS_PER_INCH) * 100) / 100;
}
function inchesToTwips(inches: number): number {
  return Math.round((Number(inches) || 0) * TWIPS_PER_INCH);
}

/** Index of the matching preset, ignoring orientation. -1 = custom. */
const sizeIndex = computed(() => {
  const pw = Math.min(pageWidth.value, pageHeight.value);
  const ph = Math.max(pageWidth.value, pageHeight.value);
  return PAGE_SIZES.findIndex((s) => Math.abs(s.width - pw) < 20 && Math.abs(s.height - ph) < 20);
});

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return;
    const sp = props.sectionProperties;
    const w = sp?.pageWidth || DEFAULT_WIDTH;
    const h = sp?.pageHeight || DEFAULT_HEIGHT;
    pageWidth.value = w;
    pageHeight.value = h;
    orientation.value = sp?.orientation || (w > h ? 'landscape' : 'portrait');
    marginTopIn.value = twipsToInches(sp?.marginTop ?? DEFAULT_MARGIN);
    marginBottomIn.value = twipsToInches(sp?.marginBottom ?? DEFAULT_MARGIN);
    marginLeftIn.value = twipsToInches(sp?.marginLeft ?? DEFAULT_MARGIN);
    marginRightIn.value = twipsToInches(sp?.marginRight ?? DEFAULT_MARGIN);
  },
  { immediate: true }
);

function onPageSizeChange(e: Event) {
  const index = Number((e.target as HTMLSelectElement).value);
  if (index < 0) return;
  const size = PAGE_SIZES[index];
  if (orientation.value === 'landscape') {
    pageWidth.value = size.height;
    pageHeight.value = size.width;
  } else {
    pageWidth.value = size.width;
    pageHeight.value = size.height;
  }
}

function onOrientationChange(e: Event) {
  const next = (e.target as HTMLSelectElement).value as 'portrait' | 'landscape';
  if (next === orientation.value) return;
  orientation.value = next;
  const w = pageWidth.value;
  pageWidth.value = pageHeight.value;
  pageHeight.value = w;
}

function close() {
  emit('close');
}

function apply() {
  emit('apply', {
    pageWidth: pageWidth.value,
    pageHeight: pageHeight.value,
    orientation: orientation.value,
    marginTop: inchesToTwips(marginTopIn.value),
    marginBottom: inchesToTwips(marginBottomIn.value),
    marginLeft: inchesToTwips(marginLeftIn.value),
    marginRight: inchesToTwips(marginRightIn.value),
  });
  close();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
  if (e.key === 'Enter') apply();
}
</script>

<style scoped>
.ps-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.ps-dialog {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 400px;
  max-width: 480px;
  width: 100%;
  margin: 20px;
}
.ps-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}
.ps-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ps-section-label {
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.ps-section-label--spaced {
  margin-top: 4px;
}
.ps-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ps-label {
  width: 80px;
  font-size: 13px;
  color: #6b7280;
  flex-shrink: 0;
}
.ps-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 13px;
  background: #fff;
  color: #1f2937;
  box-sizing: border-box;
}
.ps-input:focus {
  outline: none;
  border-color: #3b82f6;
}
.ps-unit {
  font-size: 11px;
  color: #6b7280;
  width: 16px;
  flex-shrink: 0;
}
.ps-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.ps-btn {
  padding: 6px 16px;
  font-size: 13px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  background: #fff;
  color: #1f2937;
}
.ps-btn:hover {
  background: #f9fafb;
}
.ps-btn--primary {
  background: #3b82f6;
  color: #fff;
  border-color: #3b82f6;
}
.ps-btn--primary:hover {
  background: #2563eb;
}
</style>
