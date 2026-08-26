<template>
  <span class="adapter-switcher" role="tablist" aria-label="Adapter">
    <a
      :href="reactHref"
      role="tab"
      :aria-selected="current === 'react'"
      :class="current === 'react' ? 'pill pill--active' : 'pill'"
    >
      React
    </a>
    <a
      :href="vueHref"
      role="tab"
      :aria-selected="current === 'vue'"
      :class="current === 'vue' ? 'pill pill--active' : 'pill'"
    >
      Vue
    </a>
  </span>
  <a
    class="adapter-source"
    :href="sourceHref"
    target="_blank"
    rel="noreferrer"
    :title="`Read the ${current === 'react' ? 'React' : 'Vue'} demo source on GitHub`"
  >
    (see source)
  </a>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    current: 'react' | 'vue';
  }>(),
  {}
);

const isDev = import.meta.env.DEV;
const reactHref = isDev ? 'http://localhost:5173/react/' : '/react/';
const vueHref = isDev ? 'http://localhost:5174/vue/' : '/vue/';

// This screen IS the sample app: the switcher points at the directory that builds it,
// so a visitor comparing the two adapters can read the exact composition on screen.
const sourceUrl = {
  react: 'https://github.com/eigenpal/docx-editor/tree/main/examples/vite',
  vue: 'https://github.com/eigenpal/docx-editor/tree/main/examples/vue',
} as const;

const sourceHref = computed(() => sourceUrl[props.current]);
</script>

<style scoped>
.adapter-switcher {
  display: inline-flex;
  background: var(--doc-bg-subtle);
  padding: 3px;
  border-radius: 8px;
  border: 1px solid var(--doc-border);
}
.pill {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--doc-text-muted);
  text-decoration: none;
  border-radius: 5px;
  transition:
    background 0.15s,
    color 0.15s;
}
.pill--active {
  background: var(--doc-surface);
  color: var(--doc-text);
  box-shadow: 0 1px 2px var(--doc-shadow-subtle);
}
/* The header row is a flex container with its own gap, so this needs no margin. */
.adapter-source {
  font-size: 12px;
  white-space: nowrap;
  color: var(--doc-text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
