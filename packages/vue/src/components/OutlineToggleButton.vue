<template>
  <button
    type="button"
    class="docx-outline-toggle docx-editor-vue__outline-toggle"
    :style="{ left: leftOffset + 'px' }"
    :title="t('editor.showDocumentOutline')"
    :aria-label="t('editor.showDocumentOutline')"
    @click="$emit('toggle')"
    @mousedown.stop
  >
    <MaterialSymbol name="format_list_bulleted" :size="20" />
  </button>
</template>

<script setup lang="ts">
// Outline toggle — Vue counterpart of React's OutlineToggleButton. Inject-based
// translation (host calls provideLocale) so the label tracks the user's i18n prop.
import { useTranslation } from '../i18n';
import MaterialSymbol from './ui/MaterialSymbol.vue';

defineProps<{
  /**
   * Left anchor (px) from the editor area's left edge. The host bumps it past
   * the vertical ruler when one is shown so the button doesn't overlap it.
   */
  leftOffset: number;
}>();

defineEmits<{ toggle: [] }>();

const { t } = useTranslation();
</script>
