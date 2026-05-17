<!--
  Vue port of packages/react/src/plugin-api/PluginHost.tsx — wraps
  the editor and surfaces a panel slot for plugins. Full feature
  parity with React's PluginHost (panels with resize / collapse /
  position, side overlays, sidebar items merged across plugins) is
  pending; this v1 covers the bones: lifecycle integration with
  core's PluginLifecycleManager, default slot for the editor, and
  named slot `panel` where consumers render plugin UI.
-->
<template>
  <div class="plugin-host" :class="`plugin-host--${panelPosition}`">
    <div class="plugin-host__editor"><slot /></div>
    <div
      v-if="$slots.panel && !panelCollapsed"
      class="plugin-host__panel"
      :style="panelStyle"
    >
      <slot name="panel" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch, type CSSProperties } from 'vue';
import {
  PluginLifecycleManager,
  injectStyles,
  type PluginLifecycleConfig,
} from '@eigenpal/docx-editor-core';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export interface PanelConfig {
  position?: 'left' | 'right' | 'bottom';
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  resizable?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

const props = withDefaults(
  defineProps<{
    plugins?: unknown[];
    editorView?: EditorView | null;
    panelConfig?: PanelConfig;
    panelCollapsed?: boolean;
  }>(),
  {
    plugins: () => [],
    panelConfig: () => ({}),
    panelCollapsed: false,
  }
);

const panelPosition = computed(() => props.panelConfig?.position ?? 'right');
const panelSize = computed(() => props.panelConfig?.defaultSize ?? 280);
const panelStyle = computed<CSSProperties>(() => ({
  width: panelPosition.value === 'bottom' ? '100%' : panelSize.value + 'px',
  height: panelPosition.value === 'bottom' ? panelSize.value + 'px' : 'auto',
}));

// Plugin lifecycle bridge — same manager core uses on the React
// side so onMount / onUnmount / onEditorReady fire identically.
const manager = new PluginLifecycleManager();

function assertVueCompatiblePlugin(plugin: unknown) {
  const value = plugin as {
    id?: string;
    adapter?: string;
    framework?: string;
    requiresAdapter?: string;
    requiresFramework?: string;
  };
  const requested =
    value?.requiresAdapter ?? value?.requiresFramework ?? value?.adapter ?? value?.framework;
  if (typeof requested === 'string' && requested.toLowerCase() === 'react') {
    throw new Error(
      `Plugin "${value.id ?? 'unknown'}" requires the React adapter and cannot be mounted in @eigenpal/docx-editor-vue. Use @eigenpal/docx-editor-react/plugin-api or a Vue-compatible plugin.`
    );
  }
}

function toLifecycleConfig(plugin: unknown): PluginLifecycleConfig {
  assertVueCompatiblePlugin(plugin);
  const value = plugin as Partial<PluginLifecycleConfig> & { id?: unknown };
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Vue plugins must provide a non-empty string id.');
  }
  return {
    id: value.id,
    styles: typeof value.styles === 'string' ? value.styles : undefined,
    initialize: typeof value.initialize === 'function' ? value.initialize : undefined,
    onStateChange: typeof value.onStateChange === 'function' ? value.onStateChange : undefined,
    destroy: typeof value.destroy === 'function' ? value.destroy : undefined,
  };
}

watch(
  [() => props.editorView, () => props.plugins],
  ([view, plugins], _previous, onCleanup) => {
    manager.destroy();
    if (!view) return;

    const configs = plugins.map(toLifecycleConfig);
    manager.initialize(configs, view);
    manager.updateStates(view);

    const styleCleanups = configs
      .filter((config) => config.styles)
      .map((config) => injectStyles(config.id, config.styles!));

    let pendingUpdate: number | null = null;
    const updatePluginStates = () => manager.updateStates(view);
    const debouncedUpdate = () => {
      if (pendingUpdate !== null) cancelAnimationFrame(pendingUpdate);
      pendingUpdate = requestAnimationFrame(updatePluginStates);
    };

    const editorDom = view.dom as HTMLElement;
    editorDom.addEventListener('input', debouncedUpdate);
    editorDom.addEventListener('focus', updatePluginStates);
    editorDom.addEventListener('click', updatePluginStates);

    const originalDispatch = view.dispatch.bind(view);
    const wrappedDispatch = ((tr: Transaction) => {
      originalDispatch(tr);
      debouncedUpdate();
    }) as typeof view.dispatch;
    view.dispatch = wrappedDispatch;

    onCleanup(() => {
      editorDom.removeEventListener('input', debouncedUpdate);
      editorDom.removeEventListener('focus', updatePluginStates);
      editorDom.removeEventListener('click', updatePluginStates);
      if (pendingUpdate !== null) cancelAnimationFrame(pendingUpdate);
      if (view.dispatch === wrappedDispatch) view.dispatch = originalDispatch;
      styleCleanups.forEach((cleanup) => cleanup());
      manager.destroy();
    });
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  manager.destroy();
});
</script>

<style scoped>
.plugin-host {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: visible;
  position: relative;
}
.plugin-host--bottom { flex-direction: column; }
.plugin-host__editor { flex: 1; min-width: 0; min-height: 0; }
.plugin-host__panel {
  flex-shrink: 0;
  background: #fff;
  border-left: 1px solid #e5e7eb;
}
.plugin-host--left .plugin-host__panel {
  border-left: none;
  border-right: 1px solid #e5e7eb;
  order: -1;
}
.plugin-host--bottom .plugin-host__panel {
  border-left: none;
  border-top: 1px solid #e5e7eb;
}
</style>
