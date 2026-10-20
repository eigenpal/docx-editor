<script setup lang="ts">
import { ref } from 'vue';
import { sourceField } from './rules';
import type { UnsupportedElement } from '@docx-editor.dev/vue';
defineProps<{ element: UnsupportedElement }>();
const expanded = ref(false);
const note = ref('');
</script>
<template>
  <section
    class="graphic-card"
    :data-local-name="element.localName"
    aria-label="Custom unsupported content"
  >
    <strong>{{
      element.localName === 'approval' ? sourceField(element, 'title') : element.label
    }}</strong>
    <span v-if="element.localName === 'approval'" class="status"
      >Status: {{ sourceField(element, 'status') }}</span
    >
    <span>{{ element.namespaceUri }} · {{ element.placement }}</span>
    <button type="button" :aria-expanded="expanded" @click="expanded = !expanded">Details</button>
    <small v-if="expanded" data-testid="details"
      >{{ element.ownerPartName }} · {{ element.nodeId }}</small
    >
    <input v-model="note" aria-label="Annotation" placeholder="Local annotation" />
  </section>
</template>
