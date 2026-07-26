<!--
  Vue editable-preview component (queue item 3). Thin wrapper over the shared
  framework-agnostic mount, behavior-identical to its React counterpart DocxEditable.tsx:
  fetch a DOCX, mount the editor (or read-only preview), and expose the engine-neutral
  EditorDriver on window for the browser smoke test.
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  DocxEditableLifecycle,
  defaultDocxEditableDependencies,
  type DemoDocxEditableLifecycle,
} from './docxEditableLifecycle.ts';
import type { EditorDriver } from './mountDocxEditor.ts';

const props = defineProps<{ fixtureUrl: string }>();

const host = ref<HTMLDivElement | null>(null);
const status = ref('Loading…');
const reopened = ref<string | null>(null);
const driverWindow = window as unknown as { __docxEditorDriver?: EditorDriver };
const lifecycle: DemoDocxEditableLifecycle = new DocxEditableLifecycle(
  {
    getHost: () => host.value,
    publishDriver: (driver) => {
      driverWindow.__docxEditorDriver = driver;
    },
    clearDriver: (driver) => {
      if (driverWindow.__docxEditorDriver === driver) delete driverWindow.__docxEditorDriver;
    },
    setStatus: (next) => {
      status.value = next;
    },
    resetReopened: () => {
      reopened.value = null;
    },
  },
  defaultDocxEditableDependencies
);

function saveReopen(): void {
  reopened.value =
    (
      window as unknown as { __docxEditorDriver?: EditorDriver }
    ).__docxEditorDriver?.saveAndReopenText() ?? '';
}

onMounted(() => void lifecycle.load(props.fixtureUrl));
watch(
  () => props.fixtureUrl,
  (url) => void lifecycle.load(url)
);
onBeforeUnmount(() => {
  lifecycle.dispose();
});
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%; min-height: 0">
    <div
      style="
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        font:
          13px system-ui,
          sans-serif;
        color: #333;
        border-bottom: 1px solid #e0e0e0;
      "
    >
      <span data-testid="editor-status">{{ status }}</span>
      <button
        type="button"
        data-testid="save-reopen"
        style="font: inherit; padding: 4px 10px; cursor: pointer"
        @click="saveReopen"
      >
        Save &amp; reopen
      </button>
      <span v-if="reopened !== null" data-testid="reopened-text" style="color: #555">
        Reopened: {{ reopened.replace(/\n/g, ' / ') }}
      </span>
    </div>
    <div
      ref="host"
      data-testid="editor-host"
      style="flex: 1; min-height: 0; overflow: auto; padding: 16px; outline: none"
    />
  </div>
</template>
