<template>
  <div v-if="editor" class="perf-hud" data-testid="composed-perf">
    <dl v-if="open && reading" class="perf-panel" role="status">
      <div
        v-for="row in reading.rows"
        :key="row.id"
        class="perf-row"
        :title="row.tip"
      >
        <dt>{{ row.label }}</dt>
        <dd :class="{ muted: row.muted }">{{ row.value }}</dd>
      </div>
    </dl>
    <button
      type="button"
      class="docx-outline-toggle"
      :aria-label="open ? 'Hide performance metrics' : 'Show performance metrics'"
      :title="open ? 'Hide performance metrics' : 'Show performance metrics'"
      :aria-expanded="open"
      @mousedown="keepCaret"
      @click="open = !open"
    >
      <svg viewBox="0 -960 960 960" width="18" height="18" aria-hidden="true">
        <path
          d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"
          fill="currentColor"
        />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { useDocxEditor, useEditorEvent } from '@docx-editor.dev/vue';
import { keepCaret } from './demoButtons';

interface PerfRow {
  id: string;
  label: string;
  value: string;
  tip: string;
  muted?: boolean;
}

interface PerfReading {
  key: string;
  rows: PerfRow[];
}

const ms = (value: number) => `${value < 10 ? value.toFixed(1) : Math.round(value)}ms`;

const PERF_TIPS = {
  layout:
    'Engine time placing paragraphs into pages for the last pass. placed N/M = paragraphs re-laid-out vs. total in the document; reused = pages carried over untouched from the previous layout.',
  paint: 'Engine time building and swapping the page DOM for the pages the pass changed.',
  selection: 'Engine time writing the model selection (caret/highlight) back into the browser.',
  frame:
    "Browser time from the commit to the frame it actually presented — the browser's own style, layout and composite after the DOM swap.",
  input:
    'Keystroke to next paint, from the Event Timing API. delay = how long the event sat queued before its handler ran.',
  stale: 'Layout passes discarded because the document changed again before they could publish.',
  fonts:
    'Which measurer produced this layout. shaped = HarfBuzz over real font bytes; fixed = monospace estimate.',
  rev: 'Document revision — the number of committed transactions this session.',
} as const;

const editor = useDocxEditor();
const open = ref(false);
const reading = ref<PerfReading | null>(null);
const frameMsRef = ref<number | null>(null);
const inputRef = ref<{ durationMs: number; delayMs: number } | null>(null);
let pollId: number | undefined;
let observer: PerformanceObserver | undefined;

function refresh(): void {
  if (!open.value) return;
  const instance = editor.value;
  const state = instance?.surface?.state();
  if (!state) return;
  const { perf } = state;
  const frameMs = frameMsRef.value;
  const input = inputRef.value;
  const fontState = instance.fontMeasurement();
  const fontValue = fontState ? (fontState.resolving ? 'resolving…' : fontState.measurer) : '';
  const key = [
    perf.layoutMs,
    perf.paintMs,
    perf.selectionMs,
    perf.placed,
    perf.total,
    perf.reusedPages,
    perf.staleDiscards,
    state.revision,
    frameMs?.toFixed(1) ?? '',
    input ? `${input.durationMs.toFixed(0)}/${input.delayMs.toFixed(1)}` : '',
    fontValue,
  ].join('|');
  if (reading.value?.key === key) return;
  const rows: PerfRow[] = [
    {
      id: 'layout',
      label: 'layout',
      value: `${ms(perf.layoutMs)} (placed ${perf.placed}/${perf.total}, reused ${perf.reusedPages})`,
      tip: PERF_TIPS.layout,
    },
    { id: 'paint', label: 'paint', value: ms(perf.paintMs), tip: PERF_TIPS.paint },
    { id: 'selection', label: 'selection', value: ms(perf.selectionMs), tip: PERF_TIPS.selection },
  ];
  if (frameMs !== null) {
    rows.push({ id: 'frame', label: 'dom frame', value: ms(frameMs), tip: PERF_TIPS.frame });
  }
  if (input) {
    rows.push({
      id: 'input',
      label: 'input',
      value: `${ms(input.durationMs)} (delay ${ms(input.delayMs)})`,
      tip: PERF_TIPS.input,
    });
  }
  if (perf.staleDiscards > 0) {
    rows.push({ id: 'stale', label: 'stale', value: String(perf.staleDiscards), tip: PERF_TIPS.stale });
  }
  if (fontValue) {
    rows.push({
      id: 'fonts',
      label: 'fonts',
      value: fontValue,
      tip: PERF_TIPS.fonts,
      muted: fontValue === 'fixed',
    });
  }
  rows.push({
    id: 'rev',
    label: 'rev',
    value: String(state.revision),
    tip: PERF_TIPS.rev,
    muted: true,
  });
  reading.value = { key, rows };
}

function measureFrame(): void {
  if (!open.value) return;
  const began = performance.now();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      frameMsRef.value = performance.now() - began;
      refresh();
    });
  });
}

useEditorEvent('change', refresh);
useEditorEvent('change', measureFrame);
useEditorEvent('selectionChange', refresh);

watch(open, (expanded) => {
  if (observer) {
    observer.disconnect();
    observer = undefined;
  }
  if (pollId !== undefined) {
    window.clearInterval(pollId);
    pollId = undefined;
  }
  if (!expanded) {
    reading.value = null;
    return;
  }
  refresh();
  pollId = window.setInterval(refresh, 500);
  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('event')
  ) {
    observer = new PerformanceObserver((list) => {
      let latest: PerformanceEventTiming | null = null;
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (entry.name === 'keydown' || entry.name === 'beforeinput' || entry.name === 'input') {
          latest = entry;
        }
      }
      if (latest) {
        inputRef.value = {
          durationMs: latest.duration,
          delayMs: latest.processingStart - latest.startTime,
        };
        refresh();
      }
    });
    observer.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
  }
});

onUnmounted(() => {
  observer?.disconnect();
  if (pollId !== undefined) window.clearInterval(pollId);
});
</script>

<style scoped>
.perf-hud {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.perf-panel {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--doc-border);
  background: var(--doc-surface);
  color: var(--doc-text);
  box-shadow: var(--doc-shadow-lg);
  font-size: 11.5px;
  line-height: 18px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.perf-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  cursor: help;
}
.perf-row dt {
  width: 64px;
  flex: none;
  color: var(--doc-text-muted);
}
.perf-row dd {
  margin: 0;
}
.perf-row dd.muted {
  color: var(--doc-text-muted);
}
</style>
