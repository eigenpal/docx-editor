<!--
  Browser harness for the PRODUCTION Vue adapter (comprehensive 4.4/4.8), behavior-identical to its
  React counterpart DocxAdapterHarness.tsx: mount the real @docx-editor.dev/vue DocxEditor with DOCX
  bytes and expose the stable engine-neutral EditorDriver on window, so a browser test exercises the
  actual published package entry (props -> createEditor -> layout -> paint -> save).
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DocxEditor } from '@docx-editor.dev/vue';
import { createEditorDriver, type EditorDriver } from '@docx-editor.dev/engine-editor';
import type { Editor } from '@docx-editor.dev/vue';

const props = defineProps<{ fixtureUrl: string }>();

const bytes = ref<Uint8Array | null>(null);
const status = ref('Loading…');

async function load(url: string): Promise<void> {
  try {
    bytes.value = new Uint8Array(await (await fetch(url)).arrayBuffer());
  } catch (e) {
    status.value = `Could not fetch fixture (${(e as Error).message}).`;
  }
}

function onReady(editor: Editor): void {
  const driver = createEditorDriver(editor);
  (window as unknown as { __docxAdapterDriver?: EditorDriver }).__docxAdapterDriver = driver;
  status.value = driver.editable() ? 'Editable (paragraphs)' : 'Read-only (contains tables/SDTs)';
}

onMounted(() => void load(props.fixtureUrl));
watch(() => props.fixtureUrl, (url) => void load(url));
onBeforeUnmount(() => {
  delete (window as unknown as { __docxAdapterDriver?: EditorDriver }).__docxAdapterDriver;
});
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%; min-height: 0">
    <div style="padding: 8px 12px; font: 13px system-ui, sans-serif; color: #333; border-bottom: 1px solid #e0e0e0">
      <span data-testid="adapter-status">{{ status }}</span>
    </div>
    <div style="flex: 1; min-height: 0; overflow: auto; padding: 16px">
      <DocxEditor v-if="bytes" :document="bytes" @ready="onReady" />
    </div>
  </div>
</template>
