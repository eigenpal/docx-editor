<!-- Vue read-only DOCX preview (queue item 2). The paired counterpart of
     EnginePreview.tsx: a THIN wrapper over the SAME shared renderDocxPreview, so both
     frameworks share one projection path and produce matching output. Read-only. -->
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { renderDocxPreview, type PreviewResult, type PreviewOptions } from './enginePreview';

const props = defineProps<{ fixtureUrl: string; options?: PreviewOptions }>();
const host = ref<HTMLElement | null>(null);
const result = ref<PreviewResult | null>(null);

async function load(): Promise<void> {
  result.value = null;
  try {
    const res = await fetch(props.fixtureUrl);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (host.value) result.value = renderDocxPreview(bytes, host.value, props.options);
  } catch (e) {
    result.value = { ok: false, pageCount: 0, error: (e as Error).message };
  }
}

onMounted(load);
watch(() => props.fixtureUrl, load);
</script>

<template>
  <div class="engine-preview">
    <div class="engine-preview__status" style="padding: 8px 12px; font: 13px system-ui, sans-serif; color: #555">
      Read-only preview (production engine) — editing and saving are not supported.
      <template v-if="result?.ok"> {{ result.pageCount }} page(s).</template>
      <template v-else-if="result"> Could not open this file ({{ result.error }}).</template>
      <template v-else> Loading…</template>
    </div>
    <div ref="host" data-testid="engine-preview"></div>
  </div>
</template>
