import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { invalidateHfDomCache } from '@eigenpal/docx-editor-core/flow-model';

/** Refresh selection overlays after the shared painter mutates visible pages. */
export function usePainterOverlayRefresh(
  pagesRef: Ref<HTMLElement | null>,
  updateBodyOverlay: () => void,
  updateHfOverlay: () => void
): void {
  onMounted(() => {
    const pages = pagesRef.value;
    if (!pages) return;
    const onPainted = () => {
      invalidateHfDomCache();
      updateBodyOverlay();
      updateHfOverlay();
    };
    pages.addEventListener('painter:painted', onPainted);
    onBeforeUnmount(() => {
      pages.removeEventListener('painter:painted', onPainted);
      invalidateHfDomCache();
    });
  });
}
