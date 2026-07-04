import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { invalidateHfDomCache } from '@eigenpal/docx-editor-core/flow-model';

/** Refresh overlays only after Vue's page-readiness guard releases them. */
export function usePainterOverlayRefresh(
  pagesRef: Ref<HTMLElement | null>,
  updateBodyOverlay: () => void,
  updateHfOverlay: () => void
): void {
  onMounted(() => {
    const pages = pagesRef.value;
    if (!pages) return;
    const onPagesReady = () => {
      invalidateHfDomCache();
      updateBodyOverlay();
      updateHfOverlay();
    };
    pages.addEventListener('docx-editor-vue:painted-pages-ready', onPagesReady);
    pages.dispatchEvent(new CustomEvent('docx-editor-vue:request-overlay-refresh'));
    onBeforeUnmount(() => {
      pages.removeEventListener('docx-editor-vue:painted-pages-ready', onPagesReady);
      invalidateHfDomCache();
    });
  });
}
