<template>
  <div v-if="isOpen" class="dialog-overlay" @mousedown.self="close">
    <div class="dialog" @mousedown.stop @keydown.stop>
      <div class="dialog__header">
        <span class="dialog__title">{{ t('dialogs.imageProperties.title') }}</span>
        <button class="dialog__close" :aria-label="t('common.closeDialog')" @click="close">
          ✕
        </button>
      </div>
      <div class="dialog__body">
        <!-- Alt text -->
        <div class="field">
          <label class="field__label">{{ t('dialogs.imageProperties.altText') }}</label>
          <textarea
            v-model="altText"
            class="field__textarea"
            :placeholder="t('dialogs.imageProperties.altTextPlaceholder')"
            rows="2"
          ></textarea>
        </div>

        <!-- Wrap type -->
        <div class="field">
          <label class="field__label">{{ t('dialogs.imageProperties.textWrapping') }}</label>
          <select v-model="wrapType" class="field__select">
            <option value="inline">{{ t('dialogs.imageProperties.wrapOptions.inline') }}</option>
            <option value="wrapRight">
              {{ t('dialogs.imageProperties.wrapOptions.wrapRight') }}
            </option>
            <option value="wrapLeft">
              {{ t('dialogs.imageProperties.wrapOptions.wrapLeft') }}
            </option>
            <option value="topAndBottom">
              {{ t('dialogs.imageProperties.wrapOptions.topAndBottom') }}
            </option>
            <option value="behind">{{ t('dialogs.imageProperties.wrapOptions.behind') }}</option>
            <option value="inFront">{{ t('dialogs.imageProperties.wrapOptions.inFront') }}</option>
          </select>
        </div>

        <!-- Border -->
        <div class="field">
          <label class="field__label">{{ t('dialogs.imageProperties.border') }}</label>
          <div class="field-row">
            <label
              >{{ t('dialogs.imageProperties.width') }}:
              <input
                v-model.number="borderWidth"
                type="number"
                min="0"
                max="20"
                step="0.5"
                class="field__input--small"
              />{{ t('common.px') }}
            </label>
            <label
              >{{ t('dialogs.imageProperties.style') }}:
              <select v-model="borderKind" class="field__select--small">
                <option value="solid">{{ t('dialogs.imageProperties.borderKinds.solid') }}</option>
                <option value="dashed">
                  {{ t('dialogs.imageProperties.borderKinds.dashed') }}
                </option>
                <option value="dotted">
                  {{ t('dialogs.imageProperties.borderKinds.dotted') }}
                </option>
                <option value="double">
                  {{ t('dialogs.imageProperties.borderKinds.double') }}
                </option>
              </select>
            </label>
            <label
              >{{ t('dialogs.imageProperties.color') }}:
              <input v-model="borderColor" type="color" class="field__color" />
            </label>
          </div>
        </div>

        <!-- Dimensions -->
        <div class="field">
          <label class="field__label">{{ t('dialogs.imageProperties.dimensions') }}</label>
          <div class="field-row">
            <label
              >{{ t('dialogs.imageProperties.widthLabel') }}
              <input
                :value="width"
                type="number"
                min="1"
                max="2000"
                class="field__input--small"
                @input="onWidthInput"
              />{{ t('common.px') }}</label
            >
            <label
              >{{ t('dialogs.imageProperties.heightLabel') }}
              <input
                :value="height"
                type="number"
                min="1"
                max="2000"
                class="field__input--small"
                @input="onHeightInput"
              />{{ t('common.px') }}</label
            >
          </div>
          <label class="field__checkbox">
            <input v-model="lockRatio" type="checkbox" />
            {{ t('dialogs.imageProperties.lockAspectRatio') }}
          </label>
        </div>

        <div class="dialog__actions">
          <button class="dialog__btn" @click="close">{{ t('common.cancel') }}</button>
          <button class="dialog__btn dialog__btn--primary" @mousedown.prevent="apply">
            {{ t('common.apply') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { useTranslation } from '../../i18n';

const { t } = useTranslation();

const props = defineProps<{
  isOpen: boolean;
  view: EditorView | null;
  pmPos: number | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const altText = ref('');
const wrapType = ref('inline');
const borderWidth = ref(0);
const borderKind = ref('solid');
const borderColor = ref('#000000');
const width = ref(200);
const height = ref(150);
const lockRatio = ref(true);
let aspectRatio = 1;

// Load current image attrs when dialog opens
watch(
  () => props.isOpen,
  (open) => {
    if (!open || !props.view || props.pmPos === null) return;
    try {
      const node = props.view.state.doc.nodeAt(props.pmPos);
      if (node && node.type.name === 'image') {
        altText.value = node.attrs.alt || '';
        borderWidth.value = node.attrs.borderWidth || 0;
        borderKind.value = node.attrs.borderKind || 'solid';
        borderColor.value = node.attrs.borderColor || '#000000';
        width.value = node.attrs.width || 200;
        height.value = node.attrs.height || 150;
        aspectRatio = width.value / (height.value || 1);
        lockRatio.value = true;

        // Derive wrap type from attrs
        const dm = node.attrs.displayMode;
        const cf = node.attrs.cssFloat;
        const wt = node.attrs.wrapType;
        if (dm === 'float' && cf === 'left') wrapType.value = 'wrapRight';
        else if (dm === 'float' && cf === 'right') wrapType.value = 'wrapLeft';
        else if (dm === 'block') wrapType.value = 'topAndBottom';
        else if (wt === 'behind') wrapType.value = 'behind';
        else if (wt === 'inFront') wrapType.value = 'inFront';
        else wrapType.value = 'inline';
      }
    } catch {
      /* ignore */
    }
  }
);

function onWidthInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  if (isNaN(val) || val < 1) return;
  width.value = val;
  if (lockRatio.value && aspectRatio > 0) {
    height.value = Math.round(val / aspectRatio);
  }
}

function onHeightInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value);
  if (isNaN(val) || val < 1) return;
  height.value = val;
  if (lockRatio.value && aspectRatio > 0) {
    width.value = Math.round(val * aspectRatio);
  }
}

function close() {
  emit('close');
}

function apply() {
  const v = props.view;
  if (!v || props.pmPos === null) return;

  try {
    const node = v.state.doc.nodeAt(props.pmPos);
    if (!node || node.type.name !== 'image') return;

    // Map wrap type to PM attributes
    let displayMode = 'inline';
    let cssFloat: string | null = null;
    let wrapTypeAttr = 'inline';

    switch (wrapType.value) {
      case 'wrapRight':
        displayMode = 'float';
        cssFloat = 'left';
        wrapTypeAttr = 'square';
        break;
      case 'wrapLeft':
        displayMode = 'float';
        cssFloat = 'right';
        wrapTypeAttr = 'square';
        break;
      case 'topAndBottom':
        displayMode = 'block';
        wrapTypeAttr = 'topAndBottom';
        break;
      case 'behind':
        displayMode = 'float';
        cssFloat = 'none';
        wrapTypeAttr = 'behind';
        break;
      case 'inFront':
        displayMode = 'float';
        cssFloat = 'none';
        wrapTypeAttr = 'inFront';
        break;
      default:
        displayMode = 'inline';
        wrapTypeAttr = 'inline';
        break;
    }

    const tr = v.state.tr.setNodeMarkup(props.pmPos, undefined, {
      ...node.attrs,
      alt: altText.value,
      width: width.value,
      height: height.value,
      borderWidth: borderWidth.value || undefined,
      borderKind: borderWidth.value > 0 ? borderKind.value : undefined,
      borderColor: borderWidth.value > 0 ? borderColor.value : undefined,
      displayMode,
      cssFloat,
      wrapType: wrapTypeAttr,
    });
    v.dispatch(tr);
  } catch {
    /* ignore */
  }

  close();
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: var(--doc-overlay);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dialog {
  background: var(--doc-surface);
  border-radius: 8px;
  box-shadow: 0 8px 30px var(--doc-shadow);
  min-width: 400px;
  max-width: 90vw;
}
.dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--doc-border);
}
.dialog__title {
  font-weight: 600;
  font-size: 14px;
  color: var(--doc-text);
}
.dialog__close {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  color: var(--doc-text-muted);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.dialog__close:hover {
  background: var(--doc-bg-hover);
}
.dialog__body {
  padding: 16px;
}
.dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.dialog__btn {
  padding: 6px 16px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  background: var(--doc-surface);
}
.dialog__btn--primary {
  background: var(--doc-primary);
  color: var(--doc-on-primary);
  border-color: var(--doc-primary);
}
.dialog__btn--primary:hover {
  background: var(--doc-primary-hover);
}

.field {
  margin-bottom: 14px;
}
.field__label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--doc-text-muted);
  margin-bottom: 4px;
}
.field__textarea {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  resize: vertical;
  box-sizing: border-box;
  font-family: inherit;
}
.field__textarea:focus {
  border-color: var(--doc-primary);
}
.field__select {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  background: var(--doc-surface);
}
.field__select--small {
  padding: 4px 6px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 12px;
  background: var(--doc-surface);
}
.field__input--small {
  width: 60px;
  padding: 4px 6px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-size: 12px;
}
.field__color {
  width: 32px;
  height: 26px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  padding: 1px;
  cursor: pointer;
}
.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: var(--doc-text-muted);
  flex-wrap: wrap;
}
.field__checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--doc-text-muted);
  margin-top: 6px;
  cursor: pointer;
}
</style>
