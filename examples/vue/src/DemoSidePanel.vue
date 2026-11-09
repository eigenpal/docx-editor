<template>
  <aside
    id="demo-side-panel"
    class="demo-panel"
    :aria-label="t('demoPanel.label')"
    @keydown="onPanelKeyDown"
  >
    <div class="demo-panel__head">
      <div
        ref="tabsRef"
        class="demo-tabs"
        role="tablist"
        :aria-label="t('demoPanel.tabs')"
        @keydown="onTabsKeyDown"
      >
        <button
          v-for="entry in DEMO_PANEL_TABS"
          :id="`${uid}-tab-${entry.id}`"
          :key="entry.id"
          type="button"
          role="tab"
          class="demo-tabs__tab"
          :aria-selected="entry.id === tab"
          :aria-controls="entry.id === tab ? `${uid}-panel-${entry.id}` : undefined"
          :aria-label="t(`demoPanel.${entry.id}`)"
          :title="entry.id === tab ? undefined : t(`demoPanel.${entry.id}`)"
          :tabindex="entry.id === tab ? 0 : -1"
          @click="emit('update:tab', entry.id)"
        >
          <DemoIcon :name="entry.icon" />
          <span class="demo-tabs__label">{{ t(`demoPanel.${entry.id}`) }}</span>
        </button>
      </div>
      <button
        type="button"
        class="demo-header-action demo-header-action--icon"
        :aria-label="t('demoPanel.close')"
        :title="t('demoPanel.close')"
        @click="close"
      >
        <DemoIcon name="close" />
      </button>
    </div>
    <div
      :id="`${uid}-panel-${tab}`"
      class="demo-panel__body"
      role="tabpanel"
      :aria-labelledby="`${uid}-tab-${tab}`"
    >
      <DocxEditorChartPane v-if="tab === 'chart'" />
      <slot v-else name="settings" />
    </div>
  </aside>
</template>

<script setup lang="ts">
// The side panel of the demo: a card beside the pages with two tabs, Chart and Settings. The
// Chart tab holds the library's `DocxEditorChartPane`. Insert > Chart and Edit chart ask for it
// through `usePaneRequest`; the pane itself moves the focus when Edit chart asks for it. The
// React example has the same panel (`examples/vite/src/DemoSidePanel.tsx`).
import { ref, useId } from 'vue';
import { DocxEditorChartPane, useDocxEditor } from '@docx-editor.dev/vue';
import { exampleText as t } from '../../shared/example-text';
import { DEMO_PANEL_TABS, nextDemoTab, type DemoPanelTab } from '../../shared/demo-tabs';
import DemoIcon from './DemoIcon.vue';

const props = defineProps<{ tab: DemoPanelTab }>();
const emit = defineEmits<{ 'update:tab': [tab: DemoPanelTab]; close: [] }>();

const editor = useDocxEditor();
const uid = `demo-panel-${useId()}`;
const tabsRef = ref<HTMLDivElement | null>(null);

function close(): void {
  emit('close');
  editor.value?.focus();
}

function onPanelKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  close();
}

// The arrow keys, Home, and End move between the tabs, and the focused tab opens.
function onTabsKeyDown(event: KeyboardEvent): void {
  const target = event.currentTarget as HTMLElement;
  const index = DEMO_PANEL_TABS.findIndex((entry) => entry.id === props.tab);
  const rtl = getComputedStyle(target).direction === 'rtl';
  const next = nextDemoTab(event.key, index, DEMO_PANEL_TABS.length, rtl);
  if (next === null) return;
  event.preventDefault();
  emit('update:tab', DEMO_PANEL_TABS[next]!.id);
  tabsRef.value?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
}
</script>
