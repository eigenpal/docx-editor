<template>
  <!-- The top bar sits on the canvas, as in the editor at docx-editor.dev. The formatting
       toolbar is not here: it floats over the page column (`ComposedEditorDemo.vue`). -->
  <div class="demo-chrome">
    <header class="demo-topbar">
      <div class="demo-topbar__brand">
        <BrandLogo :byline="false" />
        <span v-if="showAdapterSwitcher" class="demo-topbar__adapter">
          <AdapterSwitcher current="vue" />
        </span>
      </div>
      <span class="demo-topbar__divider" aria-hidden="true" />
      <div class="demo-file">
        <input
          class="demo-title"
          :value="title"
          aria-label="Document title"
          spellcheck="false"
          @input="emit('update:title', ($event.target as HTMLInputElement).value)"
        />
        <span class="demo-file__ext" aria-hidden="true">.docx</span>
        <span class="demo-file__status" role="status" aria-live="polite">{{ status }}</span>
      </div>

      <DocxEditorMenu
        class-name="demo-menubar"
        :exporters="demoExporters"
        :file-name="title"
        @open="openFilePicker"
        @save="saveDocument"
        @page-setup="showPageSetup = true"
      >
        <DocxEditorMenuFile :preset="false">
          <DocxEditorMenuOpen />
          <DocxEditorMenuRow :disabled="busy" @select="newDocument">New</DocxEditorMenuRow>
          <DocxEditorMenuSave />
          <DocxEditorMenuSubmenu label-key="toolbar.export">
            <DocxEditorMenuExportMarkdown />
            <DocxEditorMenuExportPdf />
          </DocxEditorMenuSubmenu>
          <DocxEditorMenuPrint />
          <DocxEditorMenuSeparator />
          <DocxEditorMenuPageSetup />
        </DocxEditorMenuFile>
        <DocxEditorMenuInsert>
          <DocxEditorMenuRow @select="hostMenuAlert">
            <template #icon><span aria-hidden="true">✎</span></template>
            Clause library
          </DocxEditorMenuRow>
        </DocxEditorMenuInsert>
        <DocxEditorMenuHelp>
          <DocxEditorMenuReportIssue hidden />
          <a
            class="docx-toolbar__menu-item docx-menubar__item"
            href="https://docx-editor.dev/docs"
            target="_blank"
            rel="noreferrer"
            role="menuitem"
          >
            <span class="docx-menubar__item-icon" aria-hidden="true" />
            <span class="docx-menubar__item-label">Documentation</span>
          </a>
        </DocxEditorMenuHelp>
        <DocxEditorMenuCustom id="my-menu" label="My Menu">
          <DocxEditorMenuGroup label="Custom elements">
            <DocxEditorMenuRow @select="requestCitationInsert">Insert citation</DocxEditorMenuRow>
          </DocxEditorMenuGroup>
        </DocxEditorMenuCustom>
      </DocxEditorMenu>

      <div class="demo-topbar__actions">
        <a
          class="demo-header-action demo-header-action--outline demo-source"
          :href="sourceUrlFor('Vue')"
          target="_blank"
          rel="noreferrer"
          :aria-label="t('demoTopbar.sourceTitle')"
          :title="t('demoTopbar.sourceTitle')"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
            <path :d="DEMO_GITHUB_MARK" />
          </svg>
          <span class="demo-header-action__label">{{ t('demoTopbar.source') }}</span>
        </a>
        <!-- Editing, suggesting, or viewing: the packaged control, alone in its own bar. -->
        <DocxEditorToolbar :preset="false" class="demo-modebar">
          <DocxEditorToolbarEditingMode />
        </DocxEditorToolbar>
        <span class="demo-topbar__divider" aria-hidden="true" />
        <button
          type="button"
          class="demo-header-action demo-header-action--secondary"
          :aria-label="t('demoTopbar.openDocx')"
          :title="t('demoTopbar.openDocx')"
          :disabled="busy"
          @mousedown="keepCaret"
          @click="openFilePicker"
        >
          <DemoIcon name="open" />
          <span class="demo-header-action__label">{{ t('demoTopbar.open') }}</span>
        </button>
        <button
          type="button"
          class="demo-header-action demo-header-action--secondary"
          :aria-label="t('demoTopbar.new')"
          :disabled="busy"
          @mousedown="keepCaret"
          @click="newDocument"
        >
          <DemoIcon name="new" />
          <span class="demo-header-action__label">{{ t('demoTopbar.new') }}</span>
        </button>
        <DemoExportMenu :title="title" @status="status = $event" />
        <!-- One toggle, always in this place: it shows the side panel and hides it. -->
        <button
          type="button"
          class="demo-header-action demo-header-action--icon"
          :aria-expanded="panelOpen"
          :aria-controls="panelOpen ? 'demo-side-panel' : undefined"
          :aria-label="t(panelOpen ? 'demoTopbar.panelClose' : 'demoTopbar.panelOpen')"
          :title="t(panelOpen ? 'demoTopbar.panelClose' : 'demoTopbar.panelOpen')"
          @mousedown="keepCaret"
          @click="emit('togglePanel')"
        >
          <DemoIcon :name="panelOpen ? 'panelClose' : 'panelOpen'" />
        </button>
      </div>
    </header>

    <input
      ref="fileInputRef"
      type="file"
      accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      style="display: none"
      @change="onFileSelected"
    />

    <DocxEditorFontNotice />

    <!-- Explains a file that did not open, with an action to try another one. -->
    <DocxEditorOpenFailure>
      <template #actions>
        <DocxEditorOpenFailureAction variant="primary" dismiss @click="openFilePicker">
          Open another file
        </DocxEditorOpenFailureAction>
      </template>
    </DocxEditorOpenFailure>

    <DocxEditorPageSetupDialog :open="showPageSetup" @close="showPageSetup = false" />
  </div>
</template>

<script setup lang="ts">
import { demoExporters } from '../../shared/menu-exporters';
import { computed, ref, watch } from 'vue';
import {
  DocxEditorMenu,
  DocxEditorToolbar,
  DocxEditorFontNotice,
  DocxEditorOpenFailure,
  DocxEditorOpenFailureAction,
  DocxEditorPageSetupDialog,
  useDocxEditor,
  useEditorCaret,
  useEditorState,
  type EditorCaret,
} from '@docx-editor.dev/vue';
import { blankDocumentBytes } from '@docx-editor.dev/core/editor';
import { demoCatalog, demoDirection } from '../../shared/demo-language';
import BrandLogo from '../../shared/BrandLogo.vue';
import AdapterSwitcher from './AdapterSwitcher.vue';
import { sourceUrlFor } from '../../shared/config';
import { DEMO_GITHUB_MARK } from '../../shared/demo-icons';
import DemoIcon from './DemoIcon.vue';
import DemoExportMenu from './DemoExportMenu.vue';
import { keepCaret } from './demoButtons';
import { exampleText as t } from '../../shared/example-text';
import { useSaveDocument } from './downloadDocx';

const props = defineProps<{
  title: string;
  showAdapterSwitcher: boolean;
  panelOpen: boolean;
}>();

const emit = defineEmits<{
  'update:title': [value: string];
  insertCitation: [at: EditorCaret | null];
  togglePanel: [];
}>();

const DocxEditorMenuFile = DocxEditorMenu.File;
const DocxEditorMenuOpen = DocxEditorMenu.Open;
const DocxEditorMenuRow = DocxEditorMenu.Row;
const DocxEditorMenuSave = DocxEditorMenu.Save;
const DocxEditorMenuSubmenu = DocxEditorMenu.Submenu;
const DocxEditorMenuExportMarkdown = DocxEditorMenu.ExportMarkdown;
const DocxEditorMenuExportPdf = DocxEditorMenu.ExportPdf;
const DocxEditorMenuPrint = DocxEditorMenu.Print;
const DocxEditorMenuSeparator = DocxEditorMenu.Separator;
const DocxEditorMenuPageSetup = DocxEditorMenu.PageSetup;
const DocxEditorMenuInsert = DocxEditorMenu.Insert;
const DocxEditorMenuHelp = DocxEditorMenu.Help;
const DocxEditorMenuReportIssue = DocxEditorMenu.ReportIssue;
const DocxEditorMenuCustom = DocxEditorMenu.Menu;
const DocxEditorMenuGroup = DocxEditorMenu.Group;
const DocxEditorToolbarEditingMode = DocxEditorToolbar.EditingMode;

const editor = useDocxEditor();
const caret = useEditorCaret();
// While a large file opens, the previous document is still mounted: Open and New wait.
const opening = useEditorState((snapshot) => snapshot.isOpening === true);
const busy = computed(() => !editor.value || opening.value);
const fileInputRef = ref<HTMLInputElement | null>(null);
const showPageSetup = ref(false);
// What an export is doing, beside the file name. It clears itself.
const status = ref('');
let statusTimer: ReturnType<typeof setTimeout> | undefined;
watch(status, (message) => {
  clearTimeout(statusTimer);
  if (message) statusTimer = setTimeout(() => (status.value = ''), 2600);
});

function openFilePicker(): void {
  fileInputRef.value?.click();
}

function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    emit('update:title', file.name.replace(/\.docx$/i, ''));
    void file.arrayBuffer().then((buffer) => {
      editor.value?.load(new Uint8Array(buffer));
    });
  }
  input.value = '';
}

// A right-to-left interface starts new documents right to left, in the interface language.
function newDocument(): void {
  const language = demoCatalog()?._lang;
  editor.value?.load(
    blankDocumentBytes(
      demoDirection() === 'rtl'
        ? { direction: 'rtl', ...(typeof language === 'string' ? { bidiLanguage: language } : {}) }
        : {}
    )
  );
}

const saveDocument = useSaveDocument(() => props.title);

function hostMenuAlert(): void {
  window.alert('A host action, in the packaged menu.');
}

function requestCitationInsert(): void {
  emit('insertCitation', caret.value);
}
</script>
