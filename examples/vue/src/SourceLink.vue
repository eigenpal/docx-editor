<template>
  <a
    class="source-link"
    :href="href"
    target="_blank"
    rel="noreferrer"
    :title="`Read the ${label} demo source on GitHub`"
  >
    (see source)
  </a>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ current: 'react' | 'vue' }>();

// This screen IS the sample app, so the link points at the directory that builds it and a
// visitor can read the exact composition they are looking at. It renders unconditionally:
// it says nothing about the other adapter, so it does not belong behind the
// framework-switcher flag.
const sourceUrl = {
  react: 'https://github.com/eigenpal/docx-editor/tree/main/examples/vite',
  vue: 'https://github.com/eigenpal/docx-editor/tree/main/examples/vue',
} as const;

const labels = { react: 'React', vue: 'Vue' } as const;

const href = computed(() => sourceUrl[props.current]);
const label = computed(() => labels[props.current]);
</script>

<style scoped>
/* The header row is a flex container with its own gap, so this needs no margin. */
.source-link {
  font-size: 12px;
  white-space: nowrap;
  color: var(--doc-text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
