/**
 * Layout Selection Gate
 *
 * Guards selection rendering until layout is up-to-date.
 * Uses sequenced versioning to prevent stale cursor positions.
 */

type RenderCallback = () => void;

/**
 * LayoutSelectionGate coordinates the timing between document edits and
 * layout reflow so that selection overlays are only painted against
 * current DOM geometry.
 *
 * Workflow:
 * 1. Document changes → setStateSeq(++seq)
 * 2. Layout starts → onLayoutStart()
 * 3. Layout completes → onLayoutComplete(seq)
 * 4. Selection update requested → requestRender()
 * 5. If safe → callback is called
 */
export class LayoutSelectionGate {
  /** Current document state sequence */
  #stateSeq = 0;

  /** Last painted layout sequence */
  #renderSeq = 0;

  /** Whether layout is currently being computed/painted */
  #layoutUpdating = false;

  /** Pending render callback */
  #pendingRender: RenderCallback | null = null;

  /** Registered render callbacks */
  #renderCallbacks: Set<RenderCallback> = new Set();

  /**
   * Set the document state sequence (call when document changes).
   * This should be called on every ProseMirror transaction that changes the doc.
   */
  setStateSeq(seq: number): void {
    this.#stateSeq = seq;
  }

  /**
   * Increment document state sequence (convenience method).
   * Returns the new sequence value.
   */
  incrementStateSeq(): number {
    return ++this.#stateSeq;
  }

  /**
   * Get current document state sequence.
   */
  getStateSeq(): number {
    return this.#stateSeq;
  }

  /**
   * Get current layout render sequence.
   */
  getRenderSeq(): number {
    return this.#renderSeq;
  }

  /**
   * Called when layout computation starts.
   */
  onLayoutStart(): void {
    this.#layoutUpdating = true;
  }

  /**
   * Called when layout computation and DOM painting completes.
   * @param seq - The document state sequence that was just painted
   */
  onLayoutComplete(seq: number): void {
    this.#renderSeq = seq;
    this.#layoutUpdating = false;

    // If there's a pending render and it's now safe, execute it
    this.#tryRender();
  }

  /**
   * Check if it's safe to render selection.
   * Safe when: layout is not updating AND render sequence >= state sequence
   */
  isSafeToRender(): boolean {
    return !this.#layoutUpdating && this.#renderSeq >= this.#stateSeq;
  }

  /**
   * Request a selection render. Will be executed when safe.
   * If already safe, executes immediately.
   */
  requestRender(): void {
    if (this.isSafeToRender()) {
      this.#executeRender();
    } else {
      // Mark that we have a pending render
      this.#pendingRender = () => this.#executeRender();
    }
  }

  /**
   * Register a callback to be called on render events.
   */
  onRender(callback: RenderCallback): () => void {
    this.#renderCallbacks.add(callback);
    return () => {
      this.#renderCallbacks.delete(callback);
    };
  }

  /**
   * Try to execute pending render if safe.
   */
  #tryRender(): void {
    if (this.#pendingRender && this.isSafeToRender()) {
      const render = this.#pendingRender;
      this.#pendingRender = null;
      render();
    }
  }

  /**
   * Execute all registered render callbacks.
   */
  #executeRender(): void {
    for (const callback of this.#renderCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('LayoutSelectionGate: render callback error', error);
      }
    }
  }

  /**
   * Reset the gate state (useful for testing or document reload).
   */
  reset(): void {
    this.#stateSeq = 0;
    this.#renderSeq = 0;
    this.#layoutUpdating = false;
    this.#pendingRender = null;
  }

  /**
   * Get debug info about current state.
   */
  getDebugInfo(): {
    stateSeq: number;
    renderSeq: number;
    layoutUpdating: boolean;
    hasPendingRender: boolean;
    isSafe: boolean;
  } {
    return {
      stateSeq: this.#stateSeq,
      renderSeq: this.#renderSeq,
      layoutUpdating: this.#layoutUpdating,
      hasPendingRender: this.#pendingRender !== null,
      isSafe: this.isSafeToRender(),
    };
  }
}
