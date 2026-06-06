<!--
  Vue port of packages/react/src/components/ui/ImageWrapDropdown.tsx —
  thin wrapper around IconGridDropdown with the 6 image-wrap options.
-->
<template>
  <IconGridDropdown
    :options="options"
    :active-value="activeValue"
    :trigger-icon="currentOption.iconName"
    :tooltip-content="t('imageWrap.tooltipPrefix', { label: currentOption.label })"
    :disabled="disabled"
    @select="(v: string) => $emit('change', v)"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import IconGridDropdown, { type IconGridOption } from './IconGridDropdown.vue';
import { useTranslation } from '../../i18n';
import type { TranslationKey } from '@eigenpal/docx-editor-i18n';

const props = defineProps<{
  imageContext: { wrapType: string; displayMode: string; cssFloat: string | null };
  disabled?: boolean;
}>();

defineEmits<{
  (e: 'change', wrapType: string): void;
}>();

const { t } = useTranslation();

const OPTION_DEFS: { value: string; labelKey: TranslationKey; iconName: string }[] = [
  { value: 'inline', labelKey: 'imageWrap.inline', iconName: 'format_image_left' },
  { value: 'wrapRight', labelKey: 'imageWrap.floatLeft', iconName: 'format_image_right' },
  { value: 'wrapLeft', labelKey: 'imageWrap.floatRight', iconName: 'format_image_left' },
  { value: 'topAndBottom', labelKey: 'imageWrap.topAndBottom', iconName: 'horizontal_rule' },
  { value: 'behind', labelKey: 'imageWrap.behindText', iconName: 'flip_to_back' },
  { value: 'inFront', labelKey: 'imageWrap.inFrontOfText', iconName: 'flip_to_front' },
];

const options = computed<IconGridOption[]>(() =>
  OPTION_DEFS.map((o) => ({ value: o.value, label: t(o.labelKey), iconName: o.iconName }))
);

const activeValue = computed(() => {
  const ctx = props.imageContext;
  if (ctx.displayMode === 'float' && ctx.cssFloat === 'left') return 'wrapRight';
  if (ctx.displayMode === 'float' && ctx.cssFloat === 'right') return 'wrapLeft';
  return ctx.wrapType;
});
const currentOption = computed(
  () => options.value.find((o) => o.value === activeValue.value) ?? options.value[0]
);
</script>
