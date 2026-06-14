<!--
  Vue alias for packages/react/src/components/TitleBar.tsx — the
  three-column title row (left logo / center doc-name + menu /
  right buttons). DocxEditor.vue inlines this layout; this
  standalone version exposes the same slots so plugin code can
  build its own toolbar variant.
-->
<template>
  <div class="docx-title-bar">
    <div class="docx-title-bar__left"><slot name="left" /></div>
    <div class="docx-title-bar__center">
      <slot />
    </div>
    <div class="docx-title-bar__right"><slot name="right" /></div>
  </div>
</template>

<style scoped>
/* Mirror React TitleBar.tsx:333: flex items-stretch bg-white pt-2 pb-1 */
.docx-title-bar {
  display: flex;
  align-items: stretch;
  background: var(--doc-surface);
  padding: 8px 0 4px;
  width: 100%;
  font-family: 'Google Sans Text', system-ui, sans-serif;
}
.docx-title-bar__left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0 4px 0 12px;
}
.docx-title-bar__center {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  min-width: 0;
  padding: 4px 0;
}
.docx-title-bar__right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  padding: 0 12px;
}
</style>
