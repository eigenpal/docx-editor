/**
 * Global keyboard-shortcut composable — installs a window-level keydown
 * listener that opens the keyboard-shortcuts dialog on F1, threads
 * through zoom shortcuts (Ctrl+= / Ctrl+- / Ctrl+0), and toggles
 * Find/Replace (Ctrl+F / Ctrl+H), Hyperlink (Ctrl+K), and the
 * Keyboard-shortcuts dialog itself (Ctrl+/). Ownership of the listener
 * lives here so the SFC stays out of the lifecycle wiring.
 */

import { onMounted, onBeforeUnmount, type Ref } from 'vue';

export interface UseKeyboardShortcutsOptions {
  showKeyboardShortcuts: Ref<boolean>;
  showFindReplace: Ref<boolean>;
  showHyperlink: Ref<boolean>;
  /** From useZoom — handles Ctrl+= / Ctrl+- / Ctrl+0. */
  handleZoomKeyDown: (e: KeyboardEvent) => void;
  /**
   * Host prop accessor — read freshly inside the handler so a host
   * toggle at runtime is honored. (Capturing the prop value at setup
   * time would freeze it.)
   */
  disableFindReplaceShortcuts?: () => boolean | undefined;
  /**
   * Whether `File > Open` / Cmd+O is enabled. Read freshly so a runtime host
   * toggle is honored. When false (or `onOpenDocument` is absent), Cmd+O is
   * left unhandled so the browser default stands.
   */
  showFileOpen?: () => boolean | undefined;
  /** Opens the DOCX picker — wired to the same hidden input as File > Open. */
  onOpenDocument?: () => void;
}

export function useKeyboardShortcuts(opts: UseKeyboardShortcutsOptions) {
  function handleKeyDown(e: KeyboardEvent) {
    // F1 opens keyboard shortcuts
    if (e.key === 'F1') {
      e.preventDefault();
      opts.showKeyboardShortcuts.value = true;
      return;
    }

    // Zoom shortcuts (Ctrl+=/Ctrl+-/Ctrl+0)
    opts.handleZoomKeyDown(e);

    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'o') {
      // Leave Cmd+O for the browser when Open is disabled or unhandled.
      if (!opts.showFileOpen?.() || !opts.onOpenDocument) return;
      e.preventDefault();
      opts.onOpenDocument();
      return;
    }
    if (opts.disableFindReplaceShortcuts?.() && (e.key === 'f' || e.key === 'h')) return;
    if (e.key === 'f' || e.key === 'h') {
      e.preventDefault();
      opts.showFindReplace.value = true;
    } else if (e.key === 'k') {
      e.preventDefault();
      opts.showHyperlink.value = true;
    } else if (e.key === '/') {
      e.preventDefault();
      opts.showKeyboardShortcuts.value = !opts.showKeyboardShortcuts.value;
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeyDown));
  onBeforeUnmount(() => window.removeEventListener('keydown', handleKeyDown));

  return { handleKeyDown };
}
