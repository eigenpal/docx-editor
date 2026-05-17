<!--
  Vue port of packages/react/src/components/ui/Button.tsx (shadcn/ui
  Button). Same variant + size matrix; same Tailwind class strings.
  Tailwind isn't bundled with the Vue adapter — the consumer apps
  using these classes need their own Tailwind setup. The class names
  are kept stable so React + Vue Buttons render with identical
  styling when shipped under a Tailwind-enabled host.
-->
<template>
  <button
    :class="buttonClass"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export type ButtonVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'secondary'
  | 'ghost'
  | 'link';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    className?: string;
  }>(),
  { variant: 'default', size: 'default', disabled: false, className: '' }
);

defineEmits<{
  (e: 'click', evt: MouseEvent): void;
}>();

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
};
const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-md px-3',
  lg: 'h-11 rounded-md px-8',
  icon: 'h-9 w-9',
  'icon-sm': 'h-7 w-7',
};
const BASE =
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

const buttonClass = computed(() =>
  [BASE, VARIANT_CLASSES[props.variant], SIZE_CLASSES[props.size], props.className]
    .filter(Boolean)
    .join(' ')
);
</script>
