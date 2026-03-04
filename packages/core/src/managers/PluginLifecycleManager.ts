/**
 * PluginLifecycleManager
 *
 * Framework-agnostic class for managing editor plugin lifecycle.
 * Extracted from React's `PluginHost.tsx`.
 *
 * Handles:
 * - Plugin initialization and state tracking
 * - EditorView dispatch wrapping for state change detection
 * - CSS injection/cleanup
 * - DOM event listener setup for plugin state updates
 * - Plugin destroy/cleanup
 */

import { Subscribable } from './Subscribable';
import type { PluginLifecycleConfig, PluginLifecycleSnapshot } from './types';

// ============================================================================
// CSS INJECTION UTILITY
// ============================================================================

/** Inject CSS styles into the document head. Returns a cleanup function. */
export function injectStyles(pluginId: string, css: string): () => void {
  const styleId = `plugin-styles-${pluginId}`;

  const existing = document.getElementById(styleId);
  if (existing) {
    existing.remove();
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = css;
  document.head.appendChild(style);

  return () => {
    const el = document.getElementById(styleId);
    if (el) {
      el.remove();
    }
  };
}

// ============================================================================
// MANAGER
// ============================================================================

export class PluginLifecycleManager extends Subscribable<PluginLifecycleSnapshot> {
  private plugins: PluginLifecycleConfig[] = [];
  private pluginStates = new Map<string, unknown>();
  private styleCleanups: (() => void)[] = [];
  private eventCleanup: (() => void) | null = null;
  private version = 0;
  private originalDispatch: ((tr: unknown) => void) | null = null;

  constructor() {
    super({ states: new Map(), version: 0 });
  }

  /**
   * Initialize plugins with an editor view.
   * Calls `plugin.initialize(editorView)` for each plugin,
   * injects CSS, and sets up DOM event listeners.
   */
  initialize(plugins: PluginLifecycleConfig[], editorView: any): void {
    // Clean up previous
    this.destroyPlugins();

    this.plugins = plugins;

    // Initialize plugin states
    for (const plugin of plugins) {
      if (plugin.initialize && !this.pluginStates.has(plugin.id)) {
        this.pluginStates.set(plugin.id, plugin.initialize(editorView));
      }
    }

    // Inject styles
    for (const plugin of plugins) {
      if (plugin.styles) {
        this.styleCleanups.push(injectStyles(plugin.id, plugin.styles));
      }
    }

    // Set up DOM event listeners for state change detection
    this.setupEditorListeners(editorView);

    this.emitSnapshot();
  }

  /**
   * Update all plugin states by calling `onStateChange` on each plugin.
   * Returns true if any plugin state changed.
   */
  updateStates(editorView: any): boolean {
    let anyChanged = false;
    for (const plugin of this.plugins) {
      if (plugin.onStateChange) {
        const newState = plugin.onStateChange(editorView);
        if (newState !== undefined) {
          this.pluginStates.set(plugin.id, newState);
          anyChanged = true;
        }
      }
    }

    if (anyChanged) {
      this.version++;
      this.emitSnapshot();
    }

    return anyChanged;
  }

  /** Get plugin state by ID. */
  getPluginState<T>(pluginId: string): T | undefined {
    return this.pluginStates.get(pluginId) as T | undefined;
  }

  /** Set plugin state by ID. */
  setPluginState<T>(pluginId: string, state: T): void {
    this.pluginStates.set(pluginId, state);
    this.version++;
    this.emitSnapshot();
  }

  /** Destroy all plugins and clean up. */
  destroy(): void {
    this.destroyPlugins();
    this.emitSnapshot();
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private destroyPlugins(): void {
    // Call plugin destroy
    for (const plugin of this.plugins) {
      if (plugin.destroy) {
        plugin.destroy();
      }
    }

    // Remove injected styles
    for (const cleanup of this.styleCleanups) {
      cleanup();
    }
    this.styleCleanups = [];

    // Remove event listeners
    if (this.eventCleanup) {
      this.eventCleanup();
      this.eventCleanup = null;
    }

    this.pluginStates.clear();
    this.plugins = [];
  }

  private setupEditorListeners(editorView: any): void {
    if (!editorView?.dom) return;

    const updatePluginStates = () => {
      this.updateStates(editorView);
    };

    // Debounced update for transactions and input events
    let pendingUpdate: number | null = null;
    const debouncedUpdate = () => {
      if (pendingUpdate) cancelAnimationFrame(pendingUpdate);
      pendingUpdate = requestAnimationFrame(updatePluginStates);
    };

    // Initial state update
    updatePluginStates();

    const editorDom = editorView.dom as HTMLElement;
    editorDom.addEventListener('input', debouncedUpdate);
    editorDom.addEventListener('focus', updatePluginStates);
    editorDom.addEventListener('click', updatePluginStates);

    // Wrap dispatch to catch transactions
    this.originalDispatch = editorView.dispatch.bind(editorView);
    editorView.dispatch = (tr: unknown) => {
      this.originalDispatch!(tr);
      debouncedUpdate();
    };

    this.eventCleanup = () => {
      editorDom.removeEventListener('input', debouncedUpdate);
      editorDom.removeEventListener('focus', updatePluginStates);
      editorDom.removeEventListener('click', updatePluginStates);
      if (pendingUpdate) cancelAnimationFrame(pendingUpdate);
      if (this.originalDispatch) {
        editorView.dispatch = this.originalDispatch;
        this.originalDispatch = null;
      }
    };
  }

  private emitSnapshot(): void {
    this.setSnapshot({
      states: new Map(this.pluginStates),
      version: this.version,
    });
  }
}
