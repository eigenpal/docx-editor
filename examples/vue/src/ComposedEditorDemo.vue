<template>
  <div
    :class="['docx-editor', 'demo-app', colorMode === 'dark' ? 'dark' : '']"
    data-testid="composed-mount"
  >
    <DocxEditorRoot
      v-if="bytes"
      :document="bytes"
      author="Demo Reviewer"
      mode="edit"
      :modules="proModules"
      :fonts="fonts ?? undefined"
      @font-error="onFontError"
    >
      <EditorChrome
        :title="title"
        :color-mode="colorMode"
        :show-adapter-switcher="showAdapterSwitcher"
        @update:title="title = $event"
        @update:color-mode="colorMode = $event"
        @insert-citation="citationForm = { mode: 'insert', at: $event }"
      />
      <div class="demo-ruler-row">
        <DocxEditorHorizontalRuler />
      </div>
      <div class="demo-main">
        <DocxEditorNavigation :pane-width="280" />
        <DocxEditorViewport class="demo-viewport">
          <div class="demo-vruler" aria-hidden="true">
            <DocxEditorVerticalRuler />
          </div>
          <DocxEditorHeaderFooterChrome />
          <DocxEditorNotesChrome />
          <DocxEditorContent />
          <CustomNodeChrome :on-node-click="editCitation" />
          <DocxEditorContextMenu>
            <CustomNodeContextMenu :on-edit-node="editCitation" />
          </DocxEditorContextMenu>
          <DocxEditorHyperLink />
          <DocxEditorReview :card="{ className: 'demo-review-card' }" />
        </DocxEditorViewport>
        <DocxEditorPageNumber />
        <DocxEditorLoading overlay>
          <DocxEditorLoadingSpinner />
          <span>Loading document…</span>
        </DocxEditorLoading>
        <PerfHud />
        <CitationDialog :form="citationForm" @close="citationForm = null" />
      </div>
    </DocxEditorRoot>
    <div v-else-if="loadError" class="demo-loading" role="alert">
      {{ `Could not load the document: ${loadError.message}` }}
    </div>
    <DocxEditorLoading v-else class="demo-loading">
      <DocxEditorLoadingSpinner />
      <span>Loading document…</span>
    </DocxEditorLoading>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  DocxEditorRoot,
  DocxEditorViewport,
  DocxEditorContent,
  DocxEditorToolbar,
  DocxEditorMenu,
  DocxEditorNavigation,
  DocxEditorHorizontalRuler,
  DocxEditorVerticalRuler,
  DocxEditorHeaderFooterChrome,
  DocxEditorNotesChrome,
  DocxEditorContextMenu,
  DocxEditorHyperLink,
  DocxEditorPageNumber,
  DocxEditorLoading,
  useDocxSource,
} from '@docx-editor.dev/vue';
import {
  customNodesModule,
  reviewModule,
  type ActivatedCustomNode,
} from '@docx-editor.dev/pro';
import {
  CustomNodeChrome,
  CustomNodeContextMenu,
  DocxEditorReview,
} from '@docx-editor.dev/pro/vue';
import { defaultFonts } from '@docx-editor.dev/fonts';
import EditorChrome from './EditorChrome.vue';
import PerfHud from './PerfHud.vue';
import CitationDialog from './CitationDialog.vue';
import {
  DEMO_CITATION,
  type CitationFormState,
} from './demoCitation';

void DocxEditorToolbar;
void DocxEditorMenu;

const props = defineProps<{ fixtureUrl: string }>();

const showAdapterSwitcher =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_FRAMEWORK_SWITCHER === 'true';

const proModules = [
  reviewModule(),
  customNodesModule({
    nodes: [DEMO_CITATION],
    onDiagnostic: (diagnostic) => {
      console.warn(`custom node ${diagnostic.name}: ${diagnostic.issues.join(', ')}`);
    },
  }),
];

const title = ref(
  props.fixtureUrl.split('/').pop()?.replace(/\.docx$/i, '') ?? 'Document'
);
const colorMode = ref<'light' | 'dark'>('light');
const citationForm = ref<CitationFormState | null>(null);

const { document: bytes, fonts, error: loadError } = useDocxSource(props.fixtureUrl, {
  fonts: defaultFonts,
});

function onFontError(error: { code: string; message: string }): void {
  console.warn(`[fonts] ${error.code}: ${error.message}`);
}

function editCitation(node: ActivatedCustomNode): void {
  if (!node.nodeId) return;
  citationForm.value = {
    mode: 'edit',
    nodeId: node.nodeId,
    ...(node.data === undefined ? {} : { data: node.data }),
  };
}

const DocxEditorLoadingSpinner = DocxEditorLoading.Spinner;
</script>
