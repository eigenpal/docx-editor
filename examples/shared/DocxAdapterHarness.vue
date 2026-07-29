<!--
  Browser harness for the PRODUCTION Vue adapter (comprehensive 4.4/4.8), behavior-identical to its
  React counterpart DocxAdapterHarness.tsx: mount the real @docx-editor.dev/vue DocxEditor with DOCX
  bytes and expose the stable engine-neutral EditorDriver on window, so a browser test exercises the
  actual published package entry (props -> createEditor -> layout -> paint -> save).
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  DocxEditor,
  DocxEditorShell,
  DocxEditorTitleBar,
  DocxEditorToolbar,
  HorizontalRuler,
  VerticalRuler,
  PageIndicator,
} from '@docx-editor.dev/vue';
import { createEditorDriver, type EditorDriver } from '../../packages/engine-editor/src/index.ts';
import type { FontConfiguration } from '@docx-editor.dev/core-contract/contracts/editor';
import en from '../../packages/i18n/en.json';
import { loadDemoFontConfiguration } from './demoFontShaping';

/**
 * Resolve an i18n key against `packages/i18n/en.json`, imported directly.
 *
 * The HOST owns localization: the published adapters hold only i18n keys so they
 * ship no English of their own (CLAUDE.md forbids hardcoded user-facing English in
 * components, and en.json is the single source of truth). Identical to the React
 * harness's resolver, so the two demos localize the same way.
 */
function translate(key: string): string {
  const value = key.split('.').reduce<unknown>(
    (node, part) => {
      return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined;
    },
    en as Record<string, unknown>
  );
  // Surfacing the key is deliberate when a string is missing: falling back to the
  // last segment reads like a real label and hides the gap.
  return typeof value === 'string' ? value : key;
}
import type { Editor } from '@docx-editor.dev/vue';

const props = defineProps<{ fixtureUrl: string; initialZoom?: number }>();

const bytes = ref<Uint8Array | null>(null);
const fonts = ref<FontConfiguration | null>(null);
const status = ref('Loading…');
const zoom = ref(props.initialZoom ?? 1);
// The document title is SHELL state: the engine owns no title contract (M4.0).
const title = ref('Untitled document');
const editorInstance = ref<Editor | null>(null);

async function load(url: string): Promise<void> {
  try {
    const [documentBytes, shaping] = await Promise.all([
      fetch(url).then(async (response) => new Uint8Array(await response.arrayBuffer())),
      loadDemoFontConfiguration(),
    ]);
    bytes.value = documentBytes;
    fonts.value = shaping;
  } catch (e) {
    status.value = `Could not fetch fixture (${(e as Error).message}).`;
  }
}

function syncHarness(): void {
  (
    window as unknown as { __docxAdapterHarness?: { setZoom(z: number): void; getZoom(): number } }
  ).__docxAdapterHarness = {
    setZoom: (next) => {
      zoom.value = next;
    },
    getZoom: () => zoom.value,
  };
}

function onReady(editor: Editor): void {
  const driver = createEditorDriver(editor);
  (window as unknown as { __docxAdapterDriver?: EditorDriver }).__docxAdapterDriver = driver;
  // The public Editor facade, so browser gates can assert TYPED OUTCOMES and not
  // just visible results — matching the React harness.
  (window as unknown as { __docxAdapterEditor?: Editor }).__docxAdapterEditor = editor;
  editorInstance.value = editor;
  status.value = driver.editable() ? 'Editable (paragraphs)' : 'Read-only (contains tables/SDTs)';
}

function onSave(): void {
  void editorInstance.value?.save();
}

onMounted(() => {
  syncHarness();
  void load(props.fixtureUrl);
});
watch(
  () => props.fixtureUrl,
  (url) => void load(url)
);
watch(zoom, syncHarness);
onBeforeUnmount(() => {
  delete (window as unknown as { __docxAdapterDriver?: EditorDriver }).__docxAdapterDriver;
  delete (window as unknown as { __docxAdapterEditor?: Editor }).__docxAdapterEditor;
  delete (window as unknown as { __docxAdapterHarness?: unknown }).__docxAdapterHarness;
});
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%; min-height: 0">
    <div
      style="
        padding: 8px 12px;
        font:
          13px system-ui,
          sans-serif;
        color: #333;
        border-bottom: 1px solid #e0e0e0;
      "
    >
      <span data-testid="adapter-status">{{ status }}</span>
    </div>
    <DocxEditorShell>
      <template #titleBar><DocxEditorTitleBar v-model:title="title" /></template>
      <template #toolbar
        ><DocxEditorToolbar :editor="editorInstance" :t="translate" :on-save="onSave"
      /></template>
      <template #verticalRuler><VerticalRuler :editor="editorInstance" :zoom="zoom" /></template>
      <template #horizontalRuler
        ><HorizontalRuler :editor="editorInstance" :zoom="zoom"
      /></template>
      <template #pageIndicator><PageIndicator :editor="editorInstance" /></template>
      <DocxEditor
        v-if="bytes && fonts"
        :document="bytes"
        :zoom="zoom"
        :fonts="fonts"
        @ready="onReady"
      />
    </DocxEditorShell>
  </div>
</template>
