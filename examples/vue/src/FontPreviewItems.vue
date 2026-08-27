<template>
  <template v-if="options.length === 0">
    <div class="demo-font-empty">No fonts declared in this document</div>
  </template>
  <template v-else>
    <FontFamilyItem v-for="family in options" :key="family" :value="family" class="demo-font-item">
      <span class="demo-font-item__name" :style="{ fontFamily: family }">{{ family }}</span>
    </FontFamilyItem>
  </template>
</template>

<script setup lang="ts">
import { DocxEditorToolbar, useFontFamily } from '@docx-editor.dev/vue';

const FontFamilyItem = DocxEditorToolbar.FontFamily.Item;
// Destructure so `options` is a top-level ref binding, which the template unwraps.
const { options } = useFontFamily();
</script>
