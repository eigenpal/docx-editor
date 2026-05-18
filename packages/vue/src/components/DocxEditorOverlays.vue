<!--
  Floating-popover cluster for DocxEditorVue — collects the three
  click-anchored popups that surface above the editor: the
  selection / table context menu, the image context menu, and the
  hyperlink popup. Mounted at the SFC root (after the editor scroll
  region) so their absolute positioning isn't constrained by the
  pages-viewport's `position: relative` stacking context.

  Visibility is owned by the parent's `useContextMenus` /
  `useHyperlinkManagement` composables; this component just routes
  events back so the parent can dispatch into them.
-->
<template>
  <TextContextMenu
    :is-open="contextMenu.isOpen"
    :position="contextMenu.position"
    :has-selection="contextMenu.hasSelection"
    :is-editable="!readOnly"
    :in-table="contextMenu.inTable"
    :on-image="contextMenu.onImage"
    :can-merge-cells="contextMenu.canMergeCells"
    :can-split-cell="contextMenu.canSplitCell"
    @action="(action) => emit('context-menu-action', action)"
    @close="emit('close-context-menu')"
  />

  <ImageContextMenu
    :state="imageContextMenu"
    :text-actions="imageContextMenuTextActions"
    :can-open-properties="canOpenImageProperties"
    @close="emit('close-image-context-menu')"
    @select="(target) => emit('image-wrap-select', target)"
    @text-action="(action) => emit('context-menu-action', action)"
    @open-properties="emit('open-image-properties')"
  />

  <HyperlinkPopup
    :data="hyperlinkPopupData"
    :read-only="readOnly"
    @navigate="(href) => emit('hyperlink-navigate', href)"
    @copy="emit('close-hyperlink-popup')"
    @edit="(displayText, href) => emit('hyperlink-edit', displayText, href)"
    @remove="emit('hyperlink-remove')"
    @close="emit('close-hyperlink-popup')"
  />
</template>

<script setup lang="ts">
import TextContextMenu from './TextContextMenu.vue';
import ImageContextMenu from './ImageContextMenu.vue';
import HyperlinkPopup, { type HyperlinkPopupData } from './ui/HyperlinkPopup.vue';
import type { TextContextMenuState } from '../composables/useContextMenus';
import type { ImageContextMenuState, ImageContextMenuTextAction } from './imageContextMenuTypes';
import type { ImageLayoutTarget } from '@eigenpal/docx-editor-core/prosemirror/commands';

defineProps<{
  readOnly: boolean;
  contextMenu: TextContextMenuState;
  imageContextMenu: ImageContextMenuState | null;
  imageContextMenuTextActions: ImageContextMenuTextAction[];
  canOpenImageProperties: boolean;
  hyperlinkPopupData: HyperlinkPopupData | null;
}>();

const emit = defineEmits<{
  (e: 'context-menu-action', action: string): void;
  (e: 'close-context-menu'): void;
  (e: 'image-wrap-select', target: ImageLayoutTarget): void;
  (e: 'close-image-context-menu'): void;
  (e: 'open-image-properties'): void;
  (e: 'hyperlink-navigate', href: string): void;
  (e: 'hyperlink-edit', displayText: string, href: string): void;
  (e: 'hyperlink-remove'): void;
  (e: 'close-hyperlink-popup'): void;
}>();
</script>
