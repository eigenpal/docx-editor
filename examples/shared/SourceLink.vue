<!-- This screen IS the sample app, so the link points at the directory that builds it and a
     visitor can read the exact composition they are looking at. It renders unconditionally:
     it says nothing about any other example, so it does not belong behind the
     framework-switcher flag. -->
<template>
  <a
    class="source-link"
    :href="href"
    target="_blank"
    rel="noreferrer"
    :title="`Read the ${example} example source on GitHub`"
  >
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path :d="MARK" />
    </svg>
    <span class="source-link__label">see source</span>
  </a>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { sourceUrlFor, type ExampleName } from './config';

const props = defineProps<{
  /** Which example this screen IS, by its `config.ts` name — not which adapter it uses.
   *  Several examples here render React, so the adapter would not identify the tree. */
  example: ExampleName;
}>();

const href = computed(() => sourceUrlFor(props.example));

// The GitHub mark, the same path `GitHubBadge` draws. Inline SVG, not an icon font.
const MARK =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z';
</script>

<style scoped>
/* The header row is a flex container with its own gap, so this needs no margin. */
.source-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  color: var(--doc-text-muted);
  text-decoration: none;
}

/* Underline the WORDS only. On the flex link an underline would run under the mark too. */
.source-link__label {
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
