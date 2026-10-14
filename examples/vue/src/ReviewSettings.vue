<template>
  <div ref="rootRef" class="demo-settings">
    <button
      ref="triggerRef"
      type="button"
      class="demo-settings__trigger"
      :style="TRIGGER_STYLE"
      :aria-label="t('reviewSettings.open')"
      :title="t('reviewSettings.open')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? panelId : undefined"
      :disabled="!editor"
      @mousedown="keepCaret"
      @click="open = !open"
    >
      <svg v-bind="ICON" width="16" height="16">
        <path
          d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
    <section
      v-if="open"
      :id="panelId"
      ref="panelRef"
      class="demo-settings__panel"
      role="dialog"
      :aria-labelledby="titleId"
    >
      <header class="demo-settings__header">
        <div>
          <h2 :id="titleId">{{ t('reviewSettings.title') }}</h2>
          <p>{{ t('reviewSettings.subtitle') }}</p>
        </div>
        <button
          type="button"
          class="demo-settings__close"
          :aria-label="t('reviewSettings.close')"
          @click="close"
        >
          <svg v-bind="ICON" width="16" height="16"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </header>
      <div class="demo-settings__body">
        <fieldset
          v-for="group in REVIEW_SETTINGS_GROUPS"
          :key="group.field"
          class="demo-settings__group"
          :aria-describedby="helpOf(group) ? `${uid}-${group.field}-help` : undefined"
        >
          <legend>{{ t(group.label) }}</legend>
          <div class="demo-settings__segments" :data-count="group.options.length">
            <label
              v-for="option in group.options"
              :key="option.value"
              class="demo-settings__segment"
            >
              <input
                type="radio"
                :name="`${uid}-${group.field}`"
                :value="option.value"
                :checked="pane[group.field] === option.value"
                @change="apply({ [group.field]: option.value }, true)"
              />
              <span>
                <span
                  v-if="option.preview === 'initials'"
                  class="demo-settings__badge"
                  aria-hidden="true"
                  >AB</span
                >
                <svg v-else-if="option.preview === 'icon'" v-bind="ICON" width="14" height="14">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {{ t(option.label) }}
              </span>
            </label>
          </div>
          <p v-if="helpOf(group)" :id="`${uid}-${group.field}-help`" class="demo-settings__help">
            {{ t(helpOf(group)!) }}
          </p>
        </fieldset>
      </div>
      <footer class="demo-settings__footer">
        <button
          type="button"
          class="demo-settings__reset"
          @click="apply(EXAMPLE_REVIEW_PANE, false)"
        >
          {{ t('reviewSettings.reset') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
// The review settings panel, the Vue twin of the React example's `ReviewSettings.tsx`. The
// model is shared in `examples/shared/review-settings.ts`. Every control writes through
// `editor.setReviewPaneOptions()` and reads back from `snapshot.reviewPane`.
import { nextTick, onBeforeUnmount, ref, useId, watch, type CSSProperties } from 'vue';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/vue';
import type { ResolvedReviewPane, ReviewPaneOptions } from '@docx-editor.dev/core/editor';
import { exampleText as t } from '../../shared/example-text';
import {
  EXAMPLE_REVIEW_PANE,
  REVIEW_SETTINGS_GROUPS,
  reviewSettingsHelp,
  saveReviewPane,
  storedReviewPane,
  type ReviewSettingsGroup,
} from '../../shared/review-settings';
import { DEMO_SECONDARY_BUTTON, keepCaret } from './demoButtons';
import '../../shared/review-settings.css';

const ICON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
} as const;

const TRIGGER_STYLE: CSSProperties = {
  ...DEMO_SECONDARY_BUTTON,
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 8px',
};

const editor = useDocxEditor();
const pane = useEditorState((snapshot) => snapshot.reviewPane);
const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const uid = `review-settings-${useId()}`;
const titleId = `${uid}-title`;
const panelId = `${uid}-panel`;

const helpOf = (group: ReviewSettingsGroup) => reviewSettingsHelp(group, pane.value[group.field]);

// A new editor instance starts from the module's settings; give it the saved ones too.
watch(
  editor,
  (instance) => {
    instance?.setReviewPaneOptions(storedReviewPane());
  },
  { immediate: true }
);

function close(): void {
  open.value = false;
  triggerRef.value?.focus();
}

function apply(options: ReviewPaneOptions | ResolvedReviewPane, save: boolean): void {
  const instance = editor.value;
  if (!instance) return;
  instance.setReviewPaneOptions(options);
  saveReviewPane(save ? instance.snapshot().reviewPane : null);
}

// Escape from the panel or the gear closes it and returns focus to the gear. An Escape
// elsewhere belongs to that surface. A press outside the panel closes it.
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
  const root = rootRef.value;
  const fromSettings =
    root !== null && (root.contains(event.target as Node) || root.contains(document.activeElement));
  if (!fromSettings) return;
  event.preventDefault();
  close();
}

function onDown(event: PointerEvent): void {
  if (!rootRef.value?.contains(event.target as Node)) open.value = false;
}

watch(open, async (value) => {
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', onDown);
  if (!value) return;
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown);
  // Opening moves focus to the first group's selected option.
  await nextTick();
  panelRef.value?.querySelector<HTMLInputElement>('input:checked')?.focus();
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', onDown);
});
</script>
