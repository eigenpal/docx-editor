<template>
  <span hidden />
</template>

<script setup lang="ts">
// Work every editor instance needs, once, under the Root: the saved review settings, and the
// Chart pane requests that open the side panel. A collaboration session or a new document
// builds a new instance, which starts from the module's settings.
import { watch } from 'vue';
import { useDocxEditor, usePaneRequest } from '@docx-editor.dev/vue';
import { storedReviewPane } from '../../shared/review-settings';

const emit = defineEmits<{ chartPane: [] }>();

const editor = useDocxEditor();
watch(
  editor,
  (instance) => {
    instance?.setReviewPaneOptions(storedReviewPane());
  },
  { immediate: true }
);
usePaneRequest((request) => {
  if (request.pane === 'chart') emit('chartPane');
});
</script>
