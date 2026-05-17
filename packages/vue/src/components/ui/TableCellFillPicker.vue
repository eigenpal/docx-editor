<!--
  Vue port of packages/react/src/components/ui/TableCellFillPicker.tsx —
  a thin wrapper around the advanced <ColorPicker> (mode="highlight",
  fill icon + "No fill" label) that translates its output to the hex
  string the table toolbar expects (empty string = clear fill).
-->
<template>
  <ColorPicker
    mode="highlight"
    :value="value"
    :theme="theme ?? null"
    :disabled="disabled"
    :title="t('table.cellFillColor')"
    icon="format_color_fill"
    :auto-label="t('colorPicker.noColor')"
    @change="onChange"
  />
</template>

<script setup lang="ts">
import type { ColorValue, Theme } from '@eigenpal/docx-editor-core/types/document';
import ColorPicker from './ColorPicker.vue';
import { useTranslation } from '../../i18n';

defineProps<{
  disabled?: boolean;
  theme?: Theme | null;
  /** Current fill color (RGB hex without #). */
  value?: string;
}>();

const emit = defineEmits<{
  (e: 'change', hex: string): void;
}>();

const { t } = useTranslation();

function onChange(color: ColorValue | string) {
  // Highlight mode emits a string: 'none' (clear fill) or a hex.
  if (typeof color !== 'string') return;
  emit('change', color === 'none' ? '' : color.replace(/^#/, ''));
}
</script>
