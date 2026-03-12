/**
 * PluginHost Component
 *
 * Wraps the editor and renders plugin panels.
 * Completely decoupled from editor internals.
 */

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
  forwardRef,
  useImperativeHandle,
  cloneElement,
} from 'react';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Plugin as ProseMirrorPlugin } from 'prosemirror-state';
import { PluginLifecycleManager, injectStyles as coreInjectStyles } from '@eigenpal/docx-core';
import type { ReactEditorPlugin, PluginHostProps, PluginHostRef, PanelConfig } from './types';
import { EditorContextMenuOverlay } from '../components/EditorContextMenuOverlay';
import type {
  SpellcheckMenuState,
  SpellcheckMisspelling,
} from '../plugins/spellcheck/prosemirror-plugin';
// Backwards-compatible alias
type EditorPlugin = ReactEditorPlugin;

// Default panel configuration
const DEFAULT_PANEL_CONFIG: Required<PanelConfig> = {
  position: 'right',
  defaultSize: 280,
  minSize: 200,
  maxSize: 500,
  resizable: true,
  collapsible: true,
  defaultCollapsed: false,
};

// Use the framework-agnostic injectStyles from core
const injectStyles = coreInjectStyles;

// Default styles for PluginHost - defined here so it can be used in the component
const PLUGIN_HOST_STYLES = `
.plugin-host {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: visible;
  position: relative;
}

.plugin-host-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: visible;
}


.plugin-panels-left,
.plugin-panels-right {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #f8f9fa;
  border-color: #e9ecef;
}

.plugin-panels-left {
  border-right: 1px solid #e9ecef;
}

.plugin-panels-right {
  border-left: 1px solid #e9ecef;
}

.plugin-panels-bottom {
  border-top: 1px solid #e9ecef;
  background: #f8f9fa;
}

.plugin-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.2s ease, height 0.2s ease;
}

.plugin-panel.collapsed {
  overflow: visible;
}

.plugin-panel-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #6c757d;
  white-space: nowrap;
}

.plugin-panel.collapsed .plugin-panel-toggle {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  flex-direction: column;
  height: 100%;
  padding: 8px 6px;
}

.plugin-panel-toggle:hover {
  background: #e9ecef;
  color: #495057;
}

.plugin-panel-toggle-icon {
  font-weight: bold;
  font-size: 14px;
}

.plugin-panel.collapsed .plugin-panel-toggle-icon {
  transform: rotate(90deg);
}

.plugin-panel-toggle-label {
  font-weight: 500;
}

.plugin-panel-content {
  flex: 1;
  overflow: auto;
}

/* Right panel rendered inside viewport - scrolls with content */
.plugin-panel-in-viewport {
  position: absolute;
  top: 0;
  /* Position is set dynamically via inline styles based on page edge */
  width: 220px;
  pointer-events: auto;
  z-index: 10;
  overflow: visible;
}

.plugin-panel-in-viewport.collapsed {
  width: 32px;
}

.plugin-panel-in-viewport .plugin-panel-toggle {
  position: sticky;
  top: 0;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.plugin-panel-in-viewport-content {
  overflow: visible;
  position: relative;
}

/* Plugin overlay container for rendering highlights/decorations */
.plugin-overlays-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  overflow: visible;
  z-index: 5;
}

.plugin-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.plugin-overlay > * {
  pointer-events: auto;
}
`;

/**
 * PluginHost Component
 *
 * Wraps the editor and provides:
 * - Plugin state management
 * - Panel rendering for each plugin
 * - CSS injection for plugin styles
 * - Callbacks for editor interaction
 */
export const PluginHost = forwardRef<PluginHostRef, PluginHostProps>(function PluginHost(
  { plugins, children, className = '' },
  ref
) {
  // Editor view reference
  const [editorView, setEditorView] = useState<EditorView | null>(null);

  // Store children.props in a ref to avoid infinite re-render loops
  // when the child editor has unstable callback references
  const childrenPropsRef = useRef(children.props);
  childrenPropsRef.current = children.props;

  // Rendered DOM context (received from PagedEditor)
  const [renderedDomContext, setRenderedDomContext] = useState<
    import('./types').RenderedDomContext | null
  >(null);

  // PluginLifecycleManager handles: initialization, state tracking,
  // style injection, dispatch wrapping, DOM event listeners, and destroy.
  const lifecycleManager = useMemo(() => new PluginLifecycleManager(), []);

  // Subscribe to lifecycle manager state (replaces pluginStatesRef + lifecycleSnapshot.version)
  const lifecycleSnapshot = useSyncExternalStore(
    lifecycleManager.subscribe,
    lifecycleManager.getSnapshot
  );

  // Panel collapsed states
  const [collapsedPanels, setCollapsedPanels] = useState<Set<string>>(() => {
    const collapsed = new Set<string>();
    for (const plugin of plugins) {
      const config = { ...DEFAULT_PANEL_CONFIG, ...plugin.panelConfig };
      if (config.defaultCollapsed) {
        collapsed.add(plugin.id);
      }
    }
    return collapsed;
  });

  // Panel sizes (for resizable panels)
  const [panelSizes] = useState<Map<string, number>>(() => {
    const sizes = new Map<string, number>();
    for (const plugin of plugins) {
      const config = { ...DEFAULT_PANEL_CONFIG, ...plugin.panelConfig };
      sizes.set(plugin.id, config.defaultSize);
    }
    return sizes;
  });

  // Initialize plugins via lifecycle manager when editorView or plugins change
  useEffect(() => {
    if (!editorView) return;

    const configs = plugins.map((plugin) => ({
      id: plugin.id,
      styles: plugin.styles,
      initialize: plugin.initialize,
      onStateChange: plugin.onStateChange,
      destroy: plugin.destroy,
    }));

    lifecycleManager.initialize(configs, editorView);

    return () => {
      lifecycleManager.destroy();
    };
  }, [lifecycleManager, editorView, plugins]);

  // Inject plugin-specific CSS (managed by React, not the manager)
  useEffect(() => {
    const cleanups = plugins.filter((p) => p.styles).map((p) => injectStyles(p.id, p.styles!));
    return () => cleanups.forEach((fn) => fn());
  }, [plugins]);

  // DOM event listeners + dispatch wrapping for plugin state updates
  useEffect(() => {
    if (!editorView?.dom) return;

    const updatePluginStates = () => {
      lifecycleManager.updateStates(editorView);
    };

    // Debounced update via requestAnimationFrame
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
    const originalDispatch = editorView.dispatch.bind(editorView);
    editorView.dispatch = (tr: unknown) => {
      (originalDispatch as (tr: unknown) => void)(tr);
      debouncedUpdate();
    };

    return () => {
      editorDom.removeEventListener('input', debouncedUpdate);
      editorDom.removeEventListener('focus', updatePluginStates);
      editorDom.removeEventListener('click', updatePluginStates);
      if (pendingUpdate) cancelAnimationFrame(pendingUpdate);
      editorView.dispatch = originalDispatch;
    };
  }, [editorView, lifecycleManager]);

  // Inject base PluginHost styles (standalone — not plugin-specific)
  useEffect(() => {
    const cleanup = injectStyles('plugin-host-base', PLUGIN_HOST_STYLES);
    return cleanup;
  }, []);

  // Callbacks for panel interaction
  const scrollToPosition = useCallback(
    (pos: number) => {
      if (!editorView) return;

      // Get the coordinates for the position
      const coords = editorView.coordsAtPos(pos);
      if (coords) {
        // Scroll the editor to show the position
        editorView.dom.scrollIntoView({ block: 'center', inline: 'nearest' });

        // Also set selection to the position
        const { state } = editorView;
        const resolved = state.doc.resolve(Math.min(pos, state.doc.content.size));
        const tr = state.tr.setSelection(TextSelection.near(resolved));
        editorView.dispatch(tr);
        editorView.focus();
      }
    },
    [editorView]
  );

  const selectRange = useCallback(
    (from: number, to: number) => {
      if (!editorView) return;

      const { state } = editorView;
      const maxPos = state.doc.content.size;
      const safeFrom = Math.max(0, Math.min(from, maxPos));
      const safeTo = Math.max(0, Math.min(to, maxPos));
      const tr = state.tr.setSelection(TextSelection.create(state.doc, safeFrom, safeTo));
      editorView.dispatch(tr);
      editorView.focus();
    },
    [editorView]
  );

  // Get plugin state helper — delegates to lifecycle manager
  const getPluginState = useCallback(
    <T,>(pluginId: string): T | undefined => {
      return lifecycleManager.getPluginState<T>(pluginId);
    },
    [lifecycleManager]
  );

  // Set plugin state helper — delegates to lifecycle manager
  const setPluginState = useCallback(
    <T,>(pluginId: string, state: T) => {
      lifecycleManager.setPluginState(pluginId, state);
    },
    [lifecycleManager]
  );

  // Refresh all plugin states — delegates to lifecycle manager
  const refreshPluginStates = useCallback(() => {
    if (!editorView) return;
    lifecycleManager.updateStates(editorView);
  }, [editorView, lifecycleManager]);

  // Expose ref methods
  useImperativeHandle(
    ref,
    () => ({
      getPluginState,
      setPluginState,
      getEditorView: () => editorView,
      refreshPluginStates,
    }),
    [getPluginState, setPluginState, editorView, refreshPluginStates]
  );

  // Collect all ProseMirror plugins from plugins
  const externalProseMirrorPlugins = useMemo(() => {
    const pmPlugins: ProseMirrorPlugin[] = [];
    for (const plugin of plugins) {
      if (plugin.proseMirrorPlugins) {
        pmPlugins.push(...plugin.proseMirrorPlugins);
      }
    }
    return pmPlugins;
  }, [plugins]);

  // Handle panel collapse toggle
  const togglePanelCollapsed = useCallback((pluginId: string) => {
    setCollapsedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(pluginId)) {
        next.delete(pluginId);
      } else {
        next.add(pluginId);
      }
      return next;
    });
  }, []);

  // State for panel position (calculated from page bounds)
  const [panelLeftPosition, setPanelLeftPosition] = useState<number | null>(null);

  // Calculate panel position relative to page right edge
  useEffect(() => {
    if (!renderedDomContext) {
      setPanelLeftPosition(null);
      return;
    }

    const calculatePanelPosition = () => {
      const pagesContainer = renderedDomContext.pagesContainer;
      const firstPage = pagesContainer.querySelector('.layout-page') as HTMLElement;
      if (!firstPage) {
        setPanelLeftPosition(null);
        return;
      }

      // Get the container offset (position of pagesContainer in the overlay coordinate system)
      const containerOffset = renderedDomContext.getContainerOffset();

      // Get the first page's position and width relative to pagesContainer
      const pageRect = firstPage.getBoundingClientRect();
      const containerRect = pagesContainer.getBoundingClientRect();

      // Calculate the page's right edge relative to pagesContainer
      const pageRightInContainer = (pageRect.right - containerRect.left) / renderedDomContext.zoom;

      // Position the panel 20px to the right of the page edge, plus container offset
      const panelLeft = containerOffset.x + pageRightInContainer + 5;
      setPanelLeftPosition(panelLeft);
    };

    // Initial calculation
    calculatePanelPosition();

    // Recalculate on resize
    const handleResize = () => {
      requestAnimationFrame(calculatePanelPosition);
    };

    window.addEventListener('resize', handleResize);

    // Also observe the pagesContainer for size changes
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(calculatePanelPosition);
    });
    observer.observe(renderedDomContext.pagesContainer);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [renderedDomContext]);

  // Generate overlay elements for plugins that have renderOverlay OR right panels
  // Right panels are rendered inside the viewport so they scroll with the content
  const pluginOverlays = useMemo(() => {
    const overlays: React.ReactNode[] = [];
    const spellcheckState = lifecycleSnapshot.states.get('spellcheck') as
      | { misspellings: SpellcheckMisspelling[]; menu: SpellcheckMenuState | null }
      | undefined;

    // Add renderOverlay content
    if (renderedDomContext) {
      for (const plugin of plugins) {
        if (plugin.renderOverlay) {
          const pluginState = lifecycleSnapshot.states.get(plugin.id);
          overlays.push(
            <div key={`overlay-${plugin.id}`} className="plugin-overlay" data-plugin-id={plugin.id}>
              {plugin.renderOverlay(renderedDomContext, pluginState, editorView)}
            </div>
          );
        }
      }
    }

    overlays.push(
      <div key="overlay-context-menu" className="plugin-overlay" data-plugin-id="context-menu">
        <EditorContextMenuOverlay
          renderedDomContext={renderedDomContext}
          editorView={editorView}
          spellcheckState={spellcheckState}
        />
      </div>
    );

    // Add right panel content (rendered inside viewport to scroll with content)
    for (const plugin of plugins) {
      if (!plugin.Panel) continue;
      const position = plugin.panelConfig?.position ?? 'right';
      if (position !== 'right') continue;

      const config = { ...DEFAULT_PANEL_CONFIG, ...plugin.panelConfig };
      const isCollapsed = collapsedPanels.has(plugin.id);
      const size = panelSizes.get(plugin.id) ?? config.defaultSize;
      const Panel = plugin.Panel;
      const pluginState = lifecycleSnapshot.states.get(plugin.id);

      // Use calculated position, fall back to a default if not ready
      const leftStyle = panelLeftPosition !== null ? `${panelLeftPosition}px` : 'calc(50% + 428px)';

      overlays.push(
        <div
          key={`panel-overlay-${plugin.id}`}
          className={`plugin-panel-in-viewport ${isCollapsed ? 'collapsed' : ''}`}
          style={{ width: isCollapsed ? '32px' : `${size}px`, left: leftStyle }}
          data-plugin-id={plugin.id}
        >
          {config.collapsible && (
            <button
              className="plugin-panel-toggle"
              onClick={() => togglePanelCollapsed(plugin.id)}
              title={isCollapsed ? `Show ${plugin.name}` : `Hide ${plugin.name}`}
              aria-label={isCollapsed ? `Show ${plugin.name}` : `Hide ${plugin.name}`}
            >
              <span className="plugin-panel-toggle-icon">{isCollapsed ? '‹' : '›'}</span>
            </button>
          )}
          {!isCollapsed && renderedDomContext && (
            <div className="plugin-panel-in-viewport-content">
              <Panel
                editorView={editorView}
                doc={editorView?.state.doc ?? null}
                scrollToPosition={scrollToPosition}
                selectRange={selectRange}
                pluginState={pluginState}
                panelWidth={size}
                renderedDomContext={renderedDomContext}
              />
            </div>
          )}
        </div>
      );
    }

    return overlays.length > 0 ? overlays : null;
  }, [
    renderedDomContext,
    plugins,
    lifecycleSnapshot.version,
    editorView,
    collapsedPanels,
    panelSizes,
    scrollToPosition,
    selectRange,
    togglePanelCollapsed,
    panelLeftPosition,
  ]);

  // Callback to receive rendered DOM context from editor
  // Uses ref to avoid infinite loops when child has unstable callbacks
  const handleRenderedDomContextReady = useCallback(
    (context: import('./types').RenderedDomContext) => {
      setRenderedDomContext(context);
      // Call original callback if any - use ref to avoid dependency issues
      const originalCallback = (childrenPropsRef.current as Record<string, unknown>)
        ?.onRenderedDomContextReady;
      if (typeof originalCallback === 'function') {
        originalCallback(context);
      }
    },
    []
    // NOTE: children.props removed from dependencies - accessed via ref to prevent infinite loops
  );

  // Clone the child editor with additional props
  // Define the props we're injecting into the child editor
  type InjectedEditorProps = {
    externalPlugins?: ProseMirrorPlugin[];
    pluginOverlays?: React.ReactNode;
    onRenderedDomContextReady?: (context: import('./types').RenderedDomContext) => void;
    onEditorViewReady?: (view: EditorView) => void;
  };

  const editorElement = useMemo(() => {
    return cloneElement(children as React.ReactElement<InjectedEditorProps>, {
      externalPlugins: externalProseMirrorPlugins,
      pluginOverlays,
      onRenderedDomContextReady: handleRenderedDomContextReady,
      onEditorViewReady: (view: EditorView) => {
        setEditorView(view);
        // Call original callback if any - use ref to avoid dependency issues
        const originalCallback = (childrenPropsRef.current as Record<string, unknown>)
          ?.onEditorViewReady;
        if (typeof originalCallback === 'function') {
          originalCallback(view);
        }
      },
    });
  }, [children, externalProseMirrorPlugins, pluginOverlays, handleRenderedDomContextReady]);

  // Group plugins by panel position
  const pluginsByPosition = useMemo(() => {
    const left: EditorPlugin[] = [];
    const right: EditorPlugin[] = [];
    const bottom: EditorPlugin[] = [];

    for (const plugin of plugins) {
      if (!plugin.Panel) continue;
      const position = plugin.panelConfig?.position ?? 'right';
      if (position === 'left') left.push(plugin);
      else if (position === 'bottom') bottom.push(plugin);
      else right.push(plugin);
    }

    return { left, right, bottom };
  }, [plugins]);

  // Render a plugin panel
  const renderPanel = (plugin: EditorPlugin) => {
    if (!plugin.Panel) return null;

    const config = { ...DEFAULT_PANEL_CONFIG, ...plugin.panelConfig };
    const isCollapsed = collapsedPanels.has(plugin.id);
    const size = panelSizes.get(plugin.id) ?? config.defaultSize;

    const Panel = plugin.Panel;
    const pluginState = lifecycleSnapshot.states.get(plugin.id);

    return (
      <div
        key={plugin.id}
        className={`plugin-panel plugin-panel-${config.position} ${isCollapsed ? 'collapsed' : ''}`}
        style={{
          [config.position === 'bottom' ? 'height' : 'width']: isCollapsed ? '32px' : `${size}px`,
          minWidth:
            config.position !== 'bottom'
              ? isCollapsed
                ? '32px'
                : `${config.minSize}px`
              : undefined,
          maxWidth: config.position !== 'bottom' ? `${config.maxSize}px` : undefined,
          minHeight:
            config.position === 'bottom'
              ? isCollapsed
                ? '32px'
                : `${config.minSize}px`
              : undefined,
          maxHeight: config.position === 'bottom' ? `${config.maxSize}px` : undefined,
        }}
        data-plugin-id={plugin.id}
      >
        {config.collapsible && (
          <button
            className="plugin-panel-toggle"
            onClick={() => togglePanelCollapsed(plugin.id)}
            title={isCollapsed ? `Show ${plugin.name}` : `Hide ${plugin.name}`}
            aria-label={isCollapsed ? `Show ${plugin.name}` : `Hide ${plugin.name}`}
          >
            <span className="plugin-panel-toggle-icon">{isCollapsed ? '›' : '‹'}</span>
            {isCollapsed && <span className="plugin-panel-toggle-label">{plugin.name}</span>}
          </button>
        )}
        {!isCollapsed && (
          <div className="plugin-panel-content">
            <Panel
              editorView={editorView}
              doc={editorView?.state.doc ?? null}
              scrollToPosition={scrollToPosition}
              selectRange={selectRange}
              pluginState={pluginState}
              panelWidth={size}
              renderedDomContext={renderedDomContext ?? null}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`plugin-host ${className}`}>
      {/* Left panels */}
      {pluginsByPosition.left.length > 0 && (
        <div className="plugin-panels-left">{pluginsByPosition.left.map(renderPanel)}</div>
      )}

      {/* Main editor area */}
      <div className="plugin-host-editor">
        {editorElement}

        {/* Bottom panels */}
        {pluginsByPosition.bottom.length > 0 && (
          <div className="plugin-panels-bottom">{pluginsByPosition.bottom.map(renderPanel)}</div>
        )}
      </div>

      {/* Right panels are now rendered inside pluginOverlays to scroll with content */}
    </div>
  );
});

// Export the styles constant for external use
export { PLUGIN_HOST_STYLES };

export default PluginHost;
