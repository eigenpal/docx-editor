<!--
  Floating-popover cluster for DocxEditor — collects the
  click-anchored popups that surface above the editor: the
  selection / table context menu and the image context menu.
  Mounted at the SFC root (after the editor scroll region) so their
  absolute positioning isn't constrained by the pages-viewport's
  `position: relative` stacking context.

  The hyperlink popup lives inside the pages-viewport, not here —
  it needs to share a scroll context with the link so CSS handles
  the follow-on-scroll for free, with no JS listener.

  Visibility is owned by the parent's `useContextMenus` composable;
  this component just routes events back so the parent can dispatch
  into them.
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
</template>

<script setup lang="ts">
import TextContextMenu from '../TextContextMenu.vue';
import ImageContextMenu from '../ImageContextMenu.vue';
import type { TextContextMenuState } from '../../composables/useContextMenus';
import type { ImageContextMenuState, ImageContextMenuTextAction } from '../imageContextMenuTypes';
import type { ImageLayoutTarget } from '@eigenpal/docx-editor-core/prosemirror/commands';

defineProps<{
  readOnly: boolean;
  contextMenu: TextContextMenuState;
  imageContextMenu: ImageContextMenuState | null;
  imageContextMenuTextActions: ImageContextMenuTextAction[];
  canOpenImageProperties: boolean;
}>();

const emit = defineEmits<{
  (e: 'context-menu-action', action: string): void;
  (e: 'close-context-menu'): void;
  (e: 'image-wrap-select', target: ImageLayoutTarget): void;
  (e: 'close-image-context-menu'): void;
  (e: 'open-image-properties'): void;
}>();
</script>
