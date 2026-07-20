export interface ContentControlWidgetListenerHandlers {
  onMouseDown: (event: MouseEvent) => void;
  onClick: (event: MouseEvent) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onPagesReady: (event: Event) => void;
}

export function bindContentControlWidgetListeners(
  container: HTMLElement,
  handlers: ContentControlWidgetListenerHandlers
): () => void {
  container.addEventListener('mousedown', handlers.onMouseDown, true);
  container.addEventListener('click', handlers.onClick, true);
  container.addEventListener('keydown', handlers.onKeyDown);
  container.addEventListener('docx-editor-vue:painted-pages-ready', handlers.onPagesReady);

  return () => {
    container.removeEventListener('mousedown', handlers.onMouseDown, true);
    container.removeEventListener('click', handlers.onClick, true);
    container.removeEventListener('keydown', handlers.onKeyDown);
    container.removeEventListener('docx-editor-vue:painted-pages-ready', handlers.onPagesReady);
  };
}
