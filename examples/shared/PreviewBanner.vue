<template>
  <div class="preview-banner" role="status">
    <span>This is a <strong>preview deployment</strong>. The released editor lives at</span>
    <a href="https://docx-editor.dev" target="_blank" rel="noopener">docx-editor.dev ↗</a>
  </div>
</template>

<style scoped>
.preview-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 6px 16px;
  background: #fef3c7;
  color: #92400e;
  border-bottom: 1px solid #fde68a;
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}
.preview-banner a {
  color: #92400e;
  text-decoration: underline;
  text-decoration-color: #fcd34d;
}
</style>
