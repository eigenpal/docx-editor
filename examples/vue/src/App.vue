<template>
  <div class="app">
    <header class="header">
      <h1>DOCX Editor — Vue Example</h1>
      <p class="subtitle">
        This is a scaffold for the Vue.js integration of <code>@eigenpal/docx-core</code>.
        The editor component is not yet implemented.
      </p>
    </header>
    <main class="content">
      <div class="placeholder">
        <p>Vue editor component coming soon.</p>
        <p>
          See
          <a href="https://github.com/eigenpal/docx-js-editor" target="_blank" rel="noopener">
            the repository
          </a>
          for contribution guidelines.
        </p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
// Future: import { DocxEditor } from '@eigenpal/docx-editor-vue';
</script>

<style scoped>
.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
}
.header {
  margin-bottom: 2rem;
}
.header h1 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}
.subtitle {
  color: #64748b;
  font-size: 0.875rem;
}
.content {
  background: white;
  border-radius: 8px;
  padding: 3rem;
  text-align: center;
  border: 1px solid #e2e8f0;
}
.placeholder {
  color: #94a3b8;
}
.placeholder a {
  color: #3b82f6;
}
</style>
