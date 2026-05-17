<!--
  Vue port of packages/react/src/components/ui/ImageWrapDropdown.tsx —
  thin wrapper around IconGridDropdown with the 6 image-wrap options.
-->
<template>
  <IconGridDropdown
    :options="OPTIONS"
    :active-value="activeValue"
    :trigger-icon="currentOption.iconName"
    :tooltip-content="`Wrap: ${currentOption.label}`"
    :disabled="disabled"
    @select="(v: string) => $emit('change', v)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import IconGridDropdown, { type IconGridOption } from './IconGridDropdown.vue';

const props = defineProps<{
  imageContext: { wrapType: string; displayMode: string; cssFloat: string | null };
  disabled?: boolean;
}>();

defineEmits<{
  (e: 'change', wrapType: string): void;
}>();

const OPTIONS: IconGridOption[] = [
  { value: 'inline', label: 'In line', iconName: 'format_image_left' },
  { value: 'wrapRight', label: 'Float left', iconName: 'format_image_right' },
  { value: 'wrapLeft', label: 'Float right', iconName: 'format_image_left' },
  { value: 'topAndBottom', label: 'Top & bottom', iconName: 'horizontal_rule' },
  { value: 'behind', label: 'Behind text', iconName: 'flip_to_back' },
  { value: 'inFront', label: 'In front of text', iconName: 'flip_to_front' },
];

const activeValue = computed(() => {
  const ctx = props.imageContext;
  if (ctx.displayMode === 'float' && ctx.cssFloat === 'left') return 'wrapRight';
  if (ctx.displayMode === 'float' && ctx.cssFloat === 'right') return 'wrapLeft';
  return ctx.wrapType;
});
const currentOption = computed(
  () => OPTIONS.find((o) => o.value === activeValue.value) ?? OPTIONS[0]
);
</script>
