<template><section ref="root" class="refresh-demo-panel" /></template>
<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { useDocxEditor, useTranslation } from '@docx-editor.dev/vue';
import { mountRefreshDemoControls } from '../../shared/refresh-demo-controls';
const editor = useDocxEditor();
const root = ref<HTMLElement | null>(null);
const { t } = useTranslation();
watchEffect((cleanup) => {
  if (editor.value && root.value) cleanup(mountRefreshDemoControls(root.value, editor.value, t));
});
</script>
