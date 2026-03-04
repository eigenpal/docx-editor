/**
 * PluginLifecycleManager
 *
 * Framework-agnostic class for managing editor plugin lifecycle.
 * Extracted from React's `PluginHost.tsx`.
 *
 * Handles:
 * - Plugin initialization and state tracking
 * - Plugin state updates via `updateStates()`
 * - Plugin destroy/cleanup
 *
 * Does NOT handle (framework hosts are responsible for):
 * - CSS injection (use the exported `injectStyles` utility)
 * - DOM event listeners / dispatch wrapping
 */

import type { EditorView } from 'prosemirror-view';

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
  private version = 0;

  constructor() {
    super({ states: new Map(), version: 0 });
  }

  /**
   * Initialize plugins with an editor view.
   * Calls `plugin.initialize(editorView)` for each plugin.
   *
   * Note: CSS injection and DOM event listeners are the responsibility
   * of the framework-specific host (e.g. React PluginHost).
   */
  initialize(plugins: PluginLifecycleConfig[], editorView: EditorView): void {
    // Clean up previous
    this.destroyPlugins();

    this.plugins = plugins;

    // Initialize plugin states
    for (const plugin of plugins) {
      if (plugin.initialize && !this.pluginStates.has(plugin.id)) {
        this.pluginStates.set(plugin.id, plugin.initialize(editorView));
      }
    }

    this.emitSnapshot();
  }

  /**
   * Update all plugin states by calling `onStateChange` on each plugin.
   * Returns true if any plugin state changed.
   */
  updateStates(editorView: EditorView): boolean {
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

    this.pluginStates.clear();
    this.plugins = [];
  }

  private emitSnapshot(): void {
    this.setSnapshot({
      states: new Map(this.pluginStates),
      version: this.version,
    });
  }
}
