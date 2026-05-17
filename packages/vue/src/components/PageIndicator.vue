<template>
  <div
    class="docx-editor-vue__page-indicator"
    :style="{ opacity: visible ? 1 : 0 }"
    aria-live="polite"
    role="status"
  >
    {{ t('viewer.pageIndicator', { current: currentPage, total: totalPages }) }}
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '../i18n';

defineProps<{
  currentPage: number;
  totalPages: number;
  visible: boolean;
}>();

const { t } = useTranslation();
</script>

<style scoped>
.docx-editor-vue__page-indicator {
  /* Mounted as a sibling of the scrolling pages-viewport (in the
     non-scrolling __editor-area) so `position: absolute` keeps the
     indicator pinned to the visible right-mid edge regardless of
     scroll. Putting it inside pages-viewport made it scroll out of
     view with the content. */
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1000;
  transition: opacity 0.3s ease;
  user-select: none;
}
</style>
