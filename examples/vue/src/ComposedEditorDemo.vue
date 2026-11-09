<template>
  <!-- `?lang=ar` (or any shipped locale code) translates the chrome; the settings panel sets
       it. The library parts mirror on their own for a right-to-left catalog; the demo's own
       header is not a library part, so the wrapper takes the catalog direction. -->
  <LocaleProvider :i18n="catalog">
    <div
      :class="['docx-editor', 'demo-app', colorMode === 'dark' ? 'dark' : '']"
      data-testid="composed-mount"
      :dir="direction"
    >
      <!-- A failed fetch is NOT a loading state: it is terminal, and routing it through
         the polite live region would announce it as progress. Its own assertive region. -->
      <div v-if="loadError" class="demo-loading" role="alert">
        {{ `Could not load the document: ${loadError.message}` }}
      </div>
      <!-- The Root mounts BEFORE the bytes arrive, so the visitor sees the real chrome with
         the library's own loading overlay over it instead of a bare spinner on an empty
         page. `document` stays undefined until the fetch settles, which mounts NO document
         (not an empty one), and the Root builds a fresh editor when `document` or `fonts`
         changes identity. The React demo does the same, so both open the same way.

         Authoring is ambient: comments and tracked changes take their `@w:author` from
         `author`, the way the Office JS API sources it from context. A real app supplies
         the signed-in user; a demo supplies a name so replies can be written at all. -->
      <DocxEditorRoot
        v-else
        :document="bytes"
        author="Demo Reviewer"
        mode="edit"
        :zoom-mode="DEMO_ZOOM_MODE"
        :modules="proModules"
        :fonts="fonts ?? undefined"
        @font-error="onFontError"
      >
        <DemoEditorEffects @chart-pane="showPanel('chart')" />
        <EditorChrome
          :title="title"
          :show-adapter-switcher="showAdapterSwitcher"
          :panel-open="panelOpen"
          @update:title="title = $event"
          @toggle-panel="panelOpen = !panelOpen"
          @insert-citation="citationForm = { mode: 'insert', at: $event }"
        />
        <!-- The workspace: the page column with its dock, and the side panel beside it. -->
        <div class="demo-workspace">
          <section class="demo-docpane" aria-label="Document">
            <DocumentDock :title="title" />
            <!-- The rulers are off until the reader turns them on in Settings. -->
            <div v-if="rulers" class="demo-ruler-row">
              <DocxEditorHorizontalRuler />
            </div>
            <div class="demo-main">
              <DocxEditorNavigation :pane-width="280" />
              <DocxEditorViewport class="demo-viewport">
                <div v-if="rulers" class="demo-vruler">
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
              <!-- The library's loading overlay, pinned over the workspace (`.demo-main` is the
             positioned ancestor). Zero conditions wired here: the engine reports both the
             first open and a later one, so picking a large document through Open DOCX
             shows this screen instead of freezing on the old one. It renders nothing while
             the document is on screen. -->
              <DocxEditorLoading overlay />
              <PerfHud />
              <CitationDialog :form="citationForm" @close="citationForm = null" />
            </div>
            <!-- Zoom, in the corner of the canvas. -->
            <DocxEditorToolbar :preset="false" class="demo-zoombar">
              <DocxEditorToolbarZoom />
            </DocxEditorToolbar>
          </section>
          <template v-if="panelOpen">
            <!-- Where the panel covers the page, a press beside it closes it. -->
            <button
              type="button"
              class="demo-scrim"
              tabindex="-1"
              aria-hidden="true"
              @click="panelOpen = false"
            />
            <DemoSidePanel v-model:tab="panelTab" @close="panelOpen = false">
              <template #settings>
                <ReviewSettings v-model:color-mode="colorMode" v-model:rulers="rulers" />
              </template>
            </DemoSidePanel>
          </template>
        </div>
      </DocxEditorRoot>
    </div>
  </LocaleProvider>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
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
  LocaleProvider,
  useDocxSource,
} from '@docx-editor.dev/vue';
import { customNodesModule, reviewModule, type ActivatedCustomNode } from '@docx-editor.dev/pro';
import { drawingModule } from '@docx-editor.dev/pro/drawing';
import {
  CustomNodeChrome,
  CustomNodeContextMenu,
  DocxEditorReview,
} from '@docx-editor.dev/pro/vue';
import { packagedFonts } from '@docx-editor.dev/fonts';
import { googleFonts } from '@docx-editor.dev/fonts/google';
import EditorChrome from './EditorChrome.vue';
import DocumentDock from './DocumentDock.vue';
import DemoEditorEffects from './DemoEditorEffects.vue';
import DemoSidePanel from './DemoSidePanel.vue';
import ReviewSettings from './ReviewSettings.vue';
import type { DemoPanelTab } from '../../shared/demo-tabs';
import PerfHud from './PerfHud.vue';
import CitationDialog from './CitationDialog.vue';
import { DEMO_CITATION, type CitationFormState } from './demoCitation';
import { storedReviewPane } from '../../shared/review-settings';
import { DEMO_ZOOM_MODE, saveRulers, storedRulers } from '../../shared/demo-view';
import { demoCatalog, demoDirection } from '../../shared/demo-language';

void DocxEditorMenu;
const DocxEditorToolbarZoom = DocxEditorToolbar.Zoom;

const props = defineProps<{ fixtureUrl: string }>();

const catalog = demoCatalog();
const direction = demoDirection();

const showAdapterSwitcher =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_FRAMEWORK_SWITCHER === 'true';

const proModules = [
  drawingModule(),
  // The review settings panel's saved choice, or the example's start: initials markers for
  // comments and tracked change balloons, as in the React example.
  reviewModule({ pane: storedReviewPane() }),
  customNodesModule({
    nodes: [DEMO_CITATION],
    onDiagnostic: (diagnostic) => {
      console.warn(`custom node ${diagnostic.name}: ${diagnostic.issues.join(', ')}`);
    },
  }),
];

const title = ref(
  props.fixtureUrl
    .split('/')
    .pop()
    ?.replace(/\.docx$/i, '') ?? 'Document'
);
const colorMode = ref<'light' | 'dark'>('light');
const rulers = ref(storedRulers());
watch(rulers, saveRulers);
// The side panel: closed at first, on the Settings tab when opened. Insert > Chart and Edit
// chart open it on the Chart tab (`DemoEditorEffects.vue`).
const panelOpen = ref(false);
const panelTab = ref<DemoPanelTab>('settings');
function showPanel(tab: DemoPanelTab): void {
  panelTab.value = tab;
  panelOpen.value = true;
}
const citationForm = ref<CitationFormState | null>(null);

// ORDER IS PRECEDENCE. `packagedFonts()` answers first from bytes inside
// `@docx-editor.dev/fonts`, so a document naming Calibri never touches the network.
// `googleFonts()` is told which faces the packaged origin already covers and fetches only
// the rest, so composing the two never downloads the same face twice. The catalog IS a
// third party: naming a family the bundle does not carry costs a request to jsdelivr, and
// a failed fetch reaches `onFontError` below and degrades to the fixed measurer.
// `cjk: true` serves the East Asian families the sample names, in the background, as the
// React demo does.
const {
  document: bytes,
  fonts,
  error: loadError,
} = useDocxSource(props.fixtureUrl, {
  fonts: [packagedFonts(), googleFonts({ cjk: true })],
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
</script>
