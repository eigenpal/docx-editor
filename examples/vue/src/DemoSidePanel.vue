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
          v-for="entry in tabs"
          :id="`${uid}-tab-${entry.id}`"
          :key="entry.id"
          type="button"
          role="tab"
          class="demo-tabs__tab"
          :aria-selected="entry.id === shownTab"
          :aria-controls="entry.id === shownTab ? `${uid}-panel-${entry.id}` : undefined"
          :aria-label="t(`demoPanel.${entry.id}`)"
          :title="entry.id === shownTab ? undefined : t(`demoPanel.${entry.id}`)"
          :tabindex="entry.id === shownTab ? 0 : -1"
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
      :id="`${uid}-panel-${shownTab}`"
      class="demo-panel__body"
      role="tabpanel"
      :aria-labelledby="`${uid}-tab-${shownTab}`"
    >
      <DocxEditorChartPane v-if="shownTab === 'chart'" />
      <DocxEditorShapePane v-else-if="shownTab === 'shape'" />
      <slot v-else name="settings" />
    </div>
  </aside>
</template>

<script setup lang="ts">
// The side panel of the demo: a card beside the pages with a Settings tab, a Chart tab while a
// chart is selected, and a Format shape tab while a shape is selected. The tabs hold the
// library's `DocxEditorChartPane` and `DocxEditorShapePane`. Insert > Chart, Edit chart, and
// Format shape ask for them through `usePaneRequest`; each pane moves the focus itself when
// asked. The React example has the same panel (`examples/vite/src/DemoSidePanel.tsx`).
import { computed, ref, useId } from 'vue';
import {
  DocxEditorChartPane,
  DocxEditorShapePane,
  useDocxEditor,
  useSelectedChart,
  useSelectedShape,
} from '@docx-editor.dev/vue';
import { exampleText as t } from '../../shared/example-text';
import {
  nextDemoTab,
  shownDemoTab,
  visibleDemoTabs,
  type DemoPanelTab,
} from '../../shared/demo-tabs';
import DemoIcon from './DemoIcon.vue';

const props = defineProps<{ tab: DemoPanelTab }>();
const emit = defineEmits<{ 'update:tab': [tab: DemoPanelTab]; close: [] }>();

const editor = useDocxEditor();
// The Chart tab shows only while a chart is selected, and the Format shape tab only while a
// shape is selected. When the selection leaves them, the panel shows Settings.
const selectedChart = useSelectedChart();
const selectedShape = useSelectedShape();
const selection = computed(() => ({
  chart: selectedChart.chart.value !== null,
  shape: selectedShape.format.value !== null,
}));
const tabs = computed(() => visibleDemoTabs(selection.value));
const shownTab = computed(() => shownDemoTab(props.tab, selection.value));
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
  const index = tabs.value.findIndex((entry) => entry.id === shownTab.value);
  const rtl = getComputedStyle(target).direction === 'rtl';
  const next = nextDemoTab(event.key, index, tabs.value.length, rtl);
  if (next === null) return;
  event.preventDefault();
  emit('update:tab', tabs.value[next]!.id);
  tabsRef.value?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
}
</script>
