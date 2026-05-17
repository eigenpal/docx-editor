<!--
  Vue port of packages/react/src/components/ui/TableBorderColorPicker.tsx —
  a thin wrapper around the advanced <ColorPicker> (mode="border") that
  translates its ColorValue output to the hex string the table toolbar
  expects. Same theme-color matrix as the text/highlight pickers.
-->
<template>
  <ColorPicker
    mode="border"
    :value="value"
    :theme="theme ?? null"
    :disabled="disabled"
    :title="t('table.borderColor')"
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
  /** Current border color (RGB hex without #). */
  value?: string;
}>();

const emit = defineEmits<{
  (e: 'change', hex: string): void;
}>();

const { t } = useTranslation();

function onChange(color: ColorValue | string) {
  if (typeof color === 'string') emit('change', color.replace(/^#/, ''));
  else if (color.rgb) emit('change', color.rgb.replace(/^#/, ''));
  else if (color.auto) emit('change', '000000');
}
</script>
