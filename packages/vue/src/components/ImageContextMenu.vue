<!--
  ImageContextMenu — Vue twin of `packages/react/src/components/ImageContextMenu.tsx`.

  Right-click menu shown on a rendered image. Mirrors the standard image
  layout menu: the six wrap-mode options at the top, highlighted to indicate
  the current wrap type. Selecting one dispatches the core
  `setImageWrapType` PM command via the host.

  The Vue port keeps the click-to-pick path complete and matches the visual
  style of the React version. Keyboard navigation (arrow keys / Enter) is
  intentionally left for a follow-up — Esc / click-outside / option click
  are wired the same way as TextContextMenu.vue.
-->
<template>
  <Teleport to="body">
    <div
      v-if="state && state.open"
      class="image-ctx-menu-backdrop"
      @mousedown="handleBackdropMouseDown"
      @contextmenu.prevent="$emit('close')"
    />
    <div
      v-if="state && state.open"
      ref="menuRef"
      class="image-ctx-menu"
      role="menu"
      :aria-label="t('imageWrap.menu.ariaLabel')"
      data-testid="image-context-menu"
      :style="menuStyle"
      @contextmenu.prevent
      @keydown="handleKeyDown"
    >
      <button
        v-if="canOpenProperties"
        type="button"
        role="menuitem"
        class="image-ctx-menu__item"
        data-action="open-properties"
        @mousedown.prevent
        @click="handleOpenProperties"
      >
        <span class="image-ctx-menu__icon">
          <MaterialSymbol name="settings" :size="ICON_SIZE" />
        </span>
        <span class="image-ctx-menu__label">{{ t('imageWrap.menu.imageProperties') }}</span>
      </button>
      <div v-if="canOpenProperties" class="image-ctx-menu__divider" role="separator" />

      <button
        v-for="option in options"
        :key="option.choice"
        type="button"
        role="menuitem"
        class="image-ctx-menu__item"
        :class="{
          'image-ctx-menu__item--current': option.choice === currentChoice,
        }"
        :data-wrap-type="option.choice"
        :data-current="option.choice === currentChoice ? 'true' : 'false'"
        :data-disabled="!isLayoutOptionEnabled(option) ? 'true' : 'false'"
        :disabled="!isLayoutOptionEnabled(option)"
        :title="t(`imageWrap.menuDesc.${option.i18nDescKey}`)"
        @mousedown.prevent
        @click="handleSelect(option)"
      >
        <span class="image-ctx-menu__icon">
          <MaterialSymbol :name="iconName(option.iconHint)" :size="ICON_SIZE" />
        </span>
        <span class="image-ctx-menu__label">
          {{ t(`imageWrap.menu.${option.i18nLabelKey}`) }}
        </span>
        <span
          v-if="option.choice === currentChoice"
          class="image-ctx-menu__current-dot"
          :aria-label="t('imageWrap.menu.ariaLabel')"
          >●</span
        >
      </button>

      <!-- Text actions appended below a divider — Cut / Copy / Paste /
           Delete. Mirrors React's ImageContextMenu, which always shows
           these so users don't have to flip menus to do clipboard work
           on a selected image. -->
      <template v-if="textActions && textActions.length > 0">
        <div class="image-ctx-menu__divider" role="separator" />
        <template v-for="(action, i) in textActions" :key="`${action.action}-${i}`">
          <button
            type="button"
            role="menuitem"
            class="image-ctx-menu__item image-ctx-menu__item--text"
            :disabled="action.disabled"
            @mousedown.prevent
            @click="handleTextAction(action)"
          >
            <span class="image-ctx-menu__label">{{ action.label }}</span>
            <span v-if="action.shortcut" class="image-ctx-menu__shortcut">
              {{ action.shortcut }}
            </span>
          </button>
          <div v-if="action.dividerAfter" class="image-ctx-menu__divider" role="separator" />
        </template>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import MaterialSymbol from './ui/MaterialSymbol.vue';
import { useTranslation } from '../i18n';
import {
  IMAGE_LAYOUT_OPTIONS,
  deriveLayoutChoice,
  isImageLayoutOptionEnabled,
  type ImageLayoutIconHint,
  type ImageLayoutOptionDef,
} from '@eigenpal/docx-editor-core/layout-painter';
import type { ImageLayoutTarget } from '@eigenpal/docx-editor-core/prosemirror/commands';

import type {
  ImageContextMenuState,
  ImageContextMenuTextAction,
} from './imageContextMenuTypes';
export type { ImageContextMenuState, ImageContextMenuTextAction };

const props = withDefaults(
  defineProps<{
    state: ImageContextMenuState | null;
    textActions?: ImageContextMenuTextAction[];
    /** When true, an "Image properties…" entry appears at the top of the menu. */
    canOpenProperties?: boolean;
  }>(),
  { canOpenProperties: false }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'select', target: ImageLayoutTarget): void;
  (e: 'text-action', action: string): void;
  (e: 'open-properties'): void;
}>();

function handleOpenProperties() {
  emit('open-properties');
  emit('close');
}

const { t } = useTranslation();

const ICON_SIZE = 18;
const MENU_WIDTH = 260;
const MARGIN = 10;

const menuRef = ref<HTMLDivElement | null>(null);

const options = IMAGE_LAYOUT_OPTIONS;

const currentChoice = computed(() => {
  if (!props.state) return null;
  return deriveLayoutChoice(props.state.currentWrapType, props.state.currentCssFloat ?? null);
});

const ICON_BY_HINT: Record<ImageLayoutIconHint, string> = {
  inline: 'wrap_text',
  squareLeft: 'format_image_left',
  squareRight: 'format_image_right',
  behind: 'flip_to_back',
  inFront: 'flip_to_front',
};

function iconName(hint: ImageLayoutIconHint): string {
  return ICON_BY_HINT[hint];
}

const menuStyle = computed(() => {
  if (!props.state) return {} as Record<string, string | number>;
  const layoutRows = IMAGE_LAYOUT_OPTIONS.length;
  const menuHeight = layoutRows * 36 + 16;
  let x = props.state.position.x;
  let y = props.state.position.y;
  if (typeof window !== 'undefined') {
    if (x + MENU_WIDTH > window.innerWidth) x = window.innerWidth - MENU_WIDTH - MARGIN;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - MARGIN;
    if (x < MARGIN) x = MARGIN;
    if (y < MARGIN) y = MARGIN;
  }
  return {
    position: 'fixed' as const,
    left: `${x}px`,
    top: `${y}px`,
    minWidth: `${MENU_WIDTH}px`,
    zIndex: 400,
  };
});

function isLayoutOptionEnabled(option: ImageLayoutOptionDef): boolean {
  if (!props.state) return false;
  return isImageLayoutOptionEnabled(option, props.state.currentWrapType);
}

function handleSelect(option: ImageLayoutOptionDef) {
  if (!isLayoutOptionEnabled(option)) return;
  emit('select', option.choice as ImageLayoutTarget);
  emit('close');
}

function handleTextAction(action: ImageContextMenuTextAction) {
  if (action.disabled) return;
  emit('text-action', action.action);
  emit('close');
}

function handleBackdropMouseDown(e: MouseEvent) {
  // Click-outside dismissal — let the backdrop swallow the click so the
  // editor doesn't move the caret as a side effect.
  e.preventDefault();
  emit('close');
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}
</script>

<style scoped>
.image-ctx-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 399;
}
.image-ctx-menu {
  background: var(--doc-surface);
  border: 1px solid var(--doc-border-light);
  border-radius: 8px;
  box-shadow: 0 2px 10px var(--doc-shadow);
  padding: 4px 0;
  overflow: hidden;
  outline: none;
}
.image-ctx-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--doc-text);
  text-align: left;
}
.image-ctx-menu__item:hover {
  background: var(--doc-primary-light);
}
.image-ctx-menu__icon {
  display: inline-flex;
  width: 18px;
  color: var(--doc-text-muted);
}
.image-ctx-menu__item--current .image-ctx-menu__icon {
  color: var(--doc-primary);
}
.image-ctx-menu__label {
  flex: 1;
}
.image-ctx-menu__current-dot {
  font-size: 11px;
  color: var(--doc-primary);
}
.image-ctx-menu__divider {
  height: 1px;
  background: var(--doc-border-light);
  margin: 4px 0;
}
.image-ctx-menu__item--text {
  /* No leading icon — align labels with the layout-item labels by
     padding-left so the menu has a single visual baseline. */
  padding-left: 40px;
}
.image-ctx-menu__shortcut {
  font-size: 12px;
  color: var(--doc-text-muted);
}
.image-ctx-menu__item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
