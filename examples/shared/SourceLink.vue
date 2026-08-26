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
    (see source)
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
