<template>
  <div class="demo-chrome">
    <header class="demo-header">
      <div class="demo-header__left">
        <BrandLogo />
        <AdapterSwitcher v-if="showAdapterSwitcher" current="vue" />
        <SourceLink example="Vue" />
      </div>

      <div class="demo-header__title-block">
        <input
          class="demo-title"
          :value="title"
          aria-label="Document title"
          spellcheck="false"
          @input="emit('update:title', ($event.target as HTMLInputElement).value)"
        />
        <DocxEditorMenu
          @open="openFilePicker"
          @save="saveDocument"
          @page-setup="showPageSetup = true"
        >
          <DocxEditorMenuFile :preset="false">
            <DocxEditorMenuOpen />
            <DocxEditorMenuRow :disabled="!editor" @select="newDocument">New</DocxEditorMenuRow>
            <DocxEditorMenuSave />
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
      </div>

      <div class="demo-header__right">
        <ThemeToggle :value="colorMode" @update:value="emit('update:colorMode', $event)" />
        <button
          type="button"
          :style="DEMO_PRIMARY_BUTTON"
          :disabled="!editor"
          @mousedown="keepCaret"
          @click="openFilePicker"
        >
          Open DOCX
        </button>
        <button
          type="button"
          :style="DEMO_SECONDARY_BUTTON"
          :disabled="!editor"
          @mousedown="keepCaret"
          @click="newDocument"
        >
          New
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

    <DocxEditorToolbar class="demo-toolbar" @save="saveDocument">
      <DocxEditorToolbarFontFamily>
        <DocxEditorToolbarFontFamilyTrigger class="demo-font-trigger" />
        <DocxEditorToolbarFontFamilyContent class="demo-font-menu">
          <FontPreviewItems />
        </DocxEditorToolbarFontFamilyContent>
      </DocxEditorToolbarFontFamily>
    </DocxEditorToolbar>

    <DocxEditorFontNotice />

    <DocxEditorPageSetupDialog :open="showPageSetup" @close="showPageSetup = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import {
  DocxEditorMenu,
  DocxEditorToolbar,
  DocxEditorFontNotice,
  DocxEditorPageSetupDialog,
  useDocxEditor,
  useEditorCaret,
  type EditorCaret,
} from '@docx-editor.dev/vue';
import { blankDocumentBytes } from '@docx-editor.dev/core/editor';
import BrandLogo from '../../shared/BrandLogo.vue';
import AdapterSwitcher from './AdapterSwitcher.vue';
import SourceLink from '../../shared/SourceLink.vue';
import ThemeToggle from './ThemeToggle.vue';
import FontPreviewItems from './FontPreviewItems.vue';
import { DEMO_PRIMARY_BUTTON, DEMO_SECONDARY_BUTTON, keepCaret } from './demoButtons';

const props = defineProps<{
  title: string;
  colorMode: 'light' | 'dark';
  showAdapterSwitcher: boolean;
}>();

const emit = defineEmits<{
  'update:title': [value: string];
  'update:colorMode': [value: 'light' | 'dark'];
  insertCitation: [at: EditorCaret | null];
}>();

const DocxEditorMenuFile = DocxEditorMenu.File;
const DocxEditorMenuOpen = DocxEditorMenu.Open;
const DocxEditorMenuRow = DocxEditorMenu.Row;
const DocxEditorMenuSave = DocxEditorMenu.Save;
const DocxEditorMenuSeparator = DocxEditorMenu.Separator;
const DocxEditorMenuPageSetup = DocxEditorMenu.PageSetup;
const DocxEditorMenuInsert = DocxEditorMenu.Insert;
const DocxEditorMenuHelp = DocxEditorMenu.Help;
const DocxEditorMenuReportIssue = DocxEditorMenu.ReportIssue;
const DocxEditorMenuCustom = DocxEditorMenu.Menu;
const DocxEditorMenuGroup = DocxEditorMenu.Group;
const DocxEditorToolbarFontFamily = DocxEditorToolbar.FontFamily;
const DocxEditorToolbarFontFamilyTrigger = DocxEditorToolbar.FontFamily.Trigger;
const DocxEditorToolbarFontFamilyContent = DocxEditorToolbar.FontFamily.Content;

const editor = useDocxEditor();
const caret = useEditorCaret();
const fileInputRef = ref<HTMLInputElement | null>(null);
const showPageSetup = ref(false);

function downloadDocx(bytes: ArrayBuffer | Uint8Array, name: string): void {
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

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

function newDocument(): void {
  editor.value?.load(blankDocumentBytes());
}

function saveDocument(): void {
  void editor.value?.save().then((buffer) => {
    if (!buffer) return;
    downloadDocx(buffer, `${titleBase()}.docx`);
  });
}

function titleBase(): string {
  return props.title.trim() || 'document';
}

function hostMenuAlert(): void {
  window.alert('A host action, in the packaged menu.');
}

function requestCitationInsert(): void {
  emit('insertCitation', caret.value);
}
</script>
