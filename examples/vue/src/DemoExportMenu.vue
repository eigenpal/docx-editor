<template>
  <!-- The Export menu of the top bar: DOCX, PDF, or Markdown. The rows and the export itself
       come from `examples/shared/demo-export.ts`, which the React example uses too. It is a
       menu button: the arrow keys move between the rows, Escape closes the menu and returns the
       focus, and a press outside closes it. -->
  <div ref="rootRef" class="demo-menu">
    <button
      ref="triggerRef"
      type="button"
      class="demo-header-action demo-header-action--primary"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :aria-busy="busy !== null"
      :disabled="!editor || opening || busy !== null"
      @mousedown="keepCaret"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <DemoIcon name="save" />
      <span class="demo-header-action__label">{{
        busy ? t('demoExport.exporting') : t('demoExport.label')
      }}</span>
      <span class="demo-header-action__chev"><DemoIcon name="chevron" /></span>
    </button>
    <div
      v-if="open"
      :id="menuId"
      ref="menuRef"
      class="demo-menu__pop"
      role="menu"
      :aria-label="t('demoExport.label')"
      tabindex="-1"
      @keydown="onMenuKeydown"
    >
      <button
        v-for="row in DEMO_EXPORT_ROWS"
        :key="row.format"
        type="button"
        role="menuitem"
        class="demo-menu__item"
        tabindex="-1"
        @mousedown="keepCaret"
        @click="run(row.format)"
      >
        <span :class="['demo-filetype', `demo-filetype--${row.tone}`]" aria-hidden="true">
          {{ row.badge }}
        </span>
        <span class="demo-menu__text">
          <span>{{ t(row.label) }}</span>
          <span class="demo-menu__hint">{{ t(row.hint) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/vue';
import { exampleText as t } from '../../shared/example-text';
import {
  DEMO_EXPORT_ROWS,
  nextDemoMenuItem,
  runDemoExport,
  type DemoExportFormat,
} from '../../shared/demo-export';
import DemoIcon from './DemoIcon.vue';
import { keepCaret } from './demoButtons';

const props = defineProps<{ title: string }>();
const emit = defineEmits<{
  /** Says what the export is doing, for the status beside the file name. */
  status: [message: string];
}>();

const editor = useDocxEditor();
const opening = useEditorState((snapshot) => snapshot.isOpening === true);
const open = ref(false);
const busy = ref<DemoExportFormat | null>(null);
// Whether the menu opened from the keyboard, so the first row takes the focus.
let focusFirst = false;
const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const menuId = `demo-export-${useId()}`;

let removeAway: (() => void) | null = null;
watch(open, async (isOpen) => {
  removeAway?.();
  removeAway = null;
  if (!isOpen) return;
  await nextTick();
  const items = menuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]');
  if (focusFirst) items?.[0]?.focus();
  else menuRef.value?.focus();
  const doc = rootRef.value?.ownerDocument ?? document;
  const away = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Node && rootRef.value?.contains(target)) return;
    open.value = false;
  };
  doc.addEventListener('pointerdown', away, true);
  removeAway = () => doc.removeEventListener('pointerdown', away, true);
});
onBeforeUnmount(() => removeAway?.());

function toggle(): void {
  focusFirst = false;
  open.value = !open.value;
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  focusFirst = true;
  open.value = true;
}

function close(refocus: boolean): void {
  open.value = false;
  if (refocus) triggerRef.value?.focus();
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' || event.key === 'Tab') {
    if (event.key === 'Escape') event.preventDefault();
    close(event.key === 'Escape');
    return;
  }
  const items = [...(menuRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const index = items.findIndex((item) => item === event.target);
  const next = nextDemoMenuItem(event.key, index, items.length);
  if (next === null) return;
  event.preventDefault();
  items[next]?.focus();
}

async function run(format: DemoExportFormat): Promise<void> {
  close(false);
  const instance = editor.value;
  if (!instance || busy.value) return;
  busy.value = format;
  emit('status', t(format === 'docx' ? 'demoExport.saving' : 'demoExport.converting'));
  try {
    await runDemoExport(instance, format, props.title);
    emit('status', t('demoExport.downloaded'));
  } catch (error) {
    emit('status', error instanceof Error ? error.message : t('demoExport.failed'));
  } finally {
    busy.value = null;
    instance.focus();
  }
}
</script>
