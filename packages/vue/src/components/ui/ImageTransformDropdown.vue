<!--
  Vue port of packages/react/src/components/ui/ImageTransformDropdown.tsx —
  rotate CW / CCW / flip H / flip V via IconGridDropdown.
-->
<template>
  <IconGridDropdown
    :options="OPTIONS"
    trigger-icon="rotate_right"
    tooltip-content="Rotate / flip"
    :disabled="disabled"
    @select="(v: string) => $emit('transform', v as TransformAction)"
  />
</template>

<script setup lang="ts">
import IconGridDropdown, { type IconGridOption } from './IconGridDropdown.vue';

export type TransformAction = 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV';

defineProps<{
  disabled?: boolean;
}>();

defineEmits<{
  (e: 'transform', action: TransformAction): void;
}>();

const OPTIONS: IconGridOption<TransformAction>[] = [
  { value: 'rotateCW', label: 'Rotate clockwise', iconName: 'rotate_right' },
  { value: 'rotateCCW', label: 'Rotate counter-clockwise', iconName: 'rotate_left' },
  { value: 'flipH', label: 'Flip horizontal', iconName: 'swap_horiz' },
  { value: 'flipV', label: 'Flip vertical', iconName: 'swap_vert' },
];
</script>
