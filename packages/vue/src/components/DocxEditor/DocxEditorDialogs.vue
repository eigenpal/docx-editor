<!--
  Modal-dialog cluster for DocxEditor — collects the dialogs the
  editor surfaces (find/replace, hyperlink, insert symbol, image
  properties, page setup, watermark, keyboard shortcuts) so the
  parent template doesn't have to carry 60+ lines of dialog markup
  just to wire show-flags and close handlers. (Image insertion has
  no dialog — Insert > Image opens the OS file picker directly.)

  Visibility is passed via `v-model:show-*` so the parent owns
  the boolean refs and dialogs close themselves through the
  standard `update:` emit pattern. Action emits (`insert-symbol`,
  `hyperlink-submit`, `page-setup-apply`, …) bubble up so the
  feature composables in the parent can keep ownership of the
  document mutations.
-->
<template>
  <FindReplaceDialog
    :is-open="showFindReplace"
    :view="view"
    :scroll-visible-position-into-view="scrollVisiblePositionIntoView"
    @close="emit('update:showFindReplace', false)"
  />

  <HyperlinkDialog
    :is-open="showHyperlink"
    :view="view"
    :bookmarks="bookmarks"
    @close="emit('update:showHyperlink', false)"
    @submit="(data) => emit('hyperlink-submit', data)"
    @remove="emit('hyperlink-remove')"
  />

  <InsertSymbolDialog
    :is-open="showInsertSymbol"
    @close="emit('update:showInsertSymbol', false)"
    @insert="(symbol) => emit('insert-symbol', symbol)"
  />

  <ImagePropertiesDialog
    :is-open="showImageProperties"
    :view="view"
    :pm-pos="selectedImagePmPos"
    @close="emit('update:showImageProperties', false)"
  />

  <PageSetupDialog
    :is-open="showPageSetup"
    :section-properties="sectionProperties"
    @close="emit('update:showPageSetup', false)"
    @apply="(props) => emit('page-setup-apply', props)"
  />

  <WatermarkDialog
    :is-open="showWatermark"
    :current="currentWatermark"
    :presets="watermarkPresets"
    @close="emit('update:showWatermark', false)"
    @apply="(watermark) => emit('watermark-apply', watermark)"
  />

  <KeyboardShortcutsDialog
    :is-open="showKeyboardShortcuts"
    @close="emit('update:showKeyboardShortcuts', false)"
  />
</template>

<script setup lang="ts">
import type { EditorView } from 'prosemirror-view';
import type { SectionProperties, Watermark } from '@eigenpal/docx-editor-core/types/document';
import FindReplaceDialog from '../dialogs/FindReplaceDialog.vue';
import HyperlinkDialog from '../dialogs/HyperlinkDialog.vue';
import InsertSymbolDialog from '../dialogs/InsertSymbolDialog.vue';
import ImagePropertiesDialog from '../dialogs/ImagePropertiesDialog.vue';
import PageSetupDialog from '../dialogs/PageSetupDialog.vue';
import WatermarkDialog from '../dialogs/WatermarkDialog.vue';
import KeyboardShortcutsDialog from '../dialogs/KeyboardShortcutsDialog.vue';

interface BookmarkOption {
  name: string;
  label?: string;
}

interface HyperlinkSubmitPayload {
  url?: string;
  bookmark?: string;
  displayText: string;
  tooltip: string;
}

defineProps<{
  view: EditorView | null;
  bookmarks: BookmarkOption[];
  selectedImagePmPos: number | null;
  sectionProperties: SectionProperties | null;
  scrollVisiblePositionIntoView: (pmPos: number) => void;
  showFindReplace: boolean;
  showHyperlink: boolean;
  showInsertSymbol: boolean;
  showImageProperties: boolean;
  showPageSetup: boolean;
  showWatermark: boolean;
  currentWatermark: Watermark | undefined;
  watermarkPresets?: readonly string[];
  showKeyboardShortcuts: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:showFindReplace', value: boolean): void;
  (e: 'update:showHyperlink', value: boolean): void;
  (e: 'update:showInsertSymbol', value: boolean): void;
  (e: 'update:showImageProperties', value: boolean): void;
  (e: 'update:showPageSetup', value: boolean): void;
  (e: 'update:showWatermark', value: boolean): void;
  (e: 'update:showKeyboardShortcuts', value: boolean): void;
  (e: 'insert-symbol', symbol: string): void;
  (e: 'hyperlink-submit', data: HyperlinkSubmitPayload): void;
  (e: 'hyperlink-remove'): void;
  (e: 'page-setup-apply', props: Partial<SectionProperties>): void;
  (e: 'watermark-apply', watermark: Watermark | null): void;
}>();
</script>
