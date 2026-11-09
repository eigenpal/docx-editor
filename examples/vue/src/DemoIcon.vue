<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in DEMO_ICONS[name]" :key="d" :d="d" />
  </svg>
</template>

<script setup lang="ts">
// A stroke icon of the demo's own chrome. Decorative: the control names itself.
import { DEMO_ICONS, type DemoIconName } from '../../shared/demo-icons';

defineProps<{ name: DemoIconName }>();
</script>
