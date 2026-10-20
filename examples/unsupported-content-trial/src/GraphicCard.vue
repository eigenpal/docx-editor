<script setup lang="ts">
import { ref } from 'vue';
import type { UnsupportedElement } from '@docx-editor.dev/vue';
defineProps<{ element: UnsupportedElement }>();
const expanded = ref(false);
const note = ref('');
</script>
<template>
  <section class="graphic-card" aria-label="Custom unsupported content">
    <strong>{{ element.label }}</strong
    ><span>{{ element.kind }}</span>
    <button type="button" :aria-expanded="expanded" @click="expanded = !expanded">Details</button>
    <small v-if="expanded" data-testid="details">{{ element.nodeId }}</small>
    <input v-model="note" aria-label="Annotation" placeholder="Local annotation" />
  </section>
</template>
