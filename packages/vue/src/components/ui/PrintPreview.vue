<!--
  Vue port of packages/react/src/components/ui/PrintPreview.tsx —
  PrintStyles injection + a small print-trigger helper. Heavy lifting
  (parsePageRange, openPrintWindow, triggerPrint) lives in core; this
  SFC just renders the inline `<style>` block that suppresses chrome
  during browser print.
-->
<template>
  <component :is="'style'">{{ printCss }}</component>
</template>

<script setup lang="ts">
const printCss = `
@media print {
  body * { visibility: hidden; }
  .docx-print-pages, .docx-print-pages * { visibility: visible; }
  .docx-print-pages { position: absolute; left: 0; top: 0; }
  .docx-print-page {
    box-shadow: none !important;
    margin: 0 !important;
    page-break-after: always;
    page-break-inside: avoid;
  }
  img { max-width: 100%; page-break-inside: avoid; }
  table, tr { page-break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
  p { orphans: 3; widows: 3; }
}
@page { margin: 0; size: auto; }
`;
</script>
