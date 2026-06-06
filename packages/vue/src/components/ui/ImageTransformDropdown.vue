<!--
  Vue port of packages/react/src/components/ui/ImageTransformDropdown.tsx —
  rotate CW / CCW / flip H / flip V via IconGridDropdown.
-->
<template>
  <IconGridDropdown
    :options="options"
    trigger-icon="rotate_right"
    :tooltip-content="t('imageTransform.tooltip')"
    :disabled="disabled"
    @select="(v: string) => $emit('transform', v as TransformAction)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import IconGridDropdown, { type IconGridOption } from './IconGridDropdown.vue';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '@eigenpal/docx-editor-i18n';

export type TransformAction = 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';

defineProps<{
  disabled?: boolean;
}>();

defineEmits<{
  (e: 'transform', action: TransformAction): void;
}>();

const { t } = useTranslation();

const OPTION_DEFS: { value: TransformAction; labelKey: TranslationKey; iconName: string }[] = [
  { value: 'rotateCW', labelKey: 'imageTransform.rotateClockwise', iconName: 'rotate_right' },
  {
    value: 'rotateCCW',
    labelKey: 'imageTransform.rotateCounterClockwise',
    iconName: 'rotate_left',
  },
  { value: 'flipH', labelKey: 'imageTransform.flipHorizontal', iconName: 'swap_horiz' },
  { value: 'flipV', labelKey: 'imageTransform.flipVertical', iconName: 'swap_vert' },
];

const options = computed<IconGridOption<TransformAction>[]>(() =>
  OPTION_DEFS.map((o) => ({ value: o.value, label: t(o.labelKey), iconName: o.iconName }))
);
</script>
