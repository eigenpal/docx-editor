<template>
  <!-- The library toolbar as a floating dock over the page column. Editing mode lives in the
       top bar and zoom in the corner of the canvas, so the dock hides those two in place and
       keeps its room for formatting. Insert chart is not on the default bar; the dock appends
       its dropdown. -->
  <div class="demo-dock">
    <DocxEditorToolbar class="demo-docbar" @save="saveDocument">
      <DocxEditorToolbarEditingMode hidden />
      <DocxEditorToolbarZoom hidden />
      <DocxEditorToolbarFontFamily>
        <DocxEditorToolbarFontFamilyTrigger class="demo-font-trigger" />
        <DocxEditorToolbarFontFamilyContent class="demo-font-menu" />
      </DocxEditorToolbarFontFamily>
      <DocxEditorToolbarChartInsert />
    </DocxEditorToolbar>
  </div>
</template>

<script setup lang="ts">
import { DocxEditorToolbar } from '@docx-editor.dev/vue';
import { useSaveDocument } from './downloadDocx';

const props = defineProps<{ title: string }>();

const DocxEditorToolbarEditingMode = DocxEditorToolbar.EditingMode;
const DocxEditorToolbarZoom = DocxEditorToolbar.Zoom;
const DocxEditorToolbarFontFamily = DocxEditorToolbar.FontFamily;
const DocxEditorToolbarFontFamilyTrigger = DocxEditorToolbar.FontFamily.Trigger;
const DocxEditorToolbarFontFamilyContent = DocxEditorToolbar.FontFamily.Content;
const DocxEditorToolbarChartInsert = DocxEditorToolbar.ChartInsert;

const saveDocument = useSaveDocument(() => props.title);
</script>
