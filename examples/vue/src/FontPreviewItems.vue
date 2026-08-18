<template>
  <template v-if="font.options.length === 0">
    <div class="demo-font-empty">No fonts declared in this document</div>
  </template>
  <template v-else>
    <FontFamilyItem
      v-for="family in font.options"
      :key="family"
      :value="family"
      class="demo-font-item"
    >
      <span class="demo-font-item__name" :style="{ fontFamily: family }">{{ family }}</span>
    </FontFamilyItem>
  </template>
</template>

<script setup lang="ts">
import { DocxEditorToolbar, useFontFamily } from '@docx-editor.dev/vue';

const FontFamilyItem = DocxEditorToolbar.FontFamily.Item;
const font = useFontFamily();
</script>
