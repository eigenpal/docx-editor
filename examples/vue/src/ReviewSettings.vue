<template>
  <div class="demo-settings__body">
    <fieldset class="demo-settings__group">
      <legend>{{ t('demoPanel.theme') }}</legend>
      <div class="demo-settings__segments" data-count="2">
        <label v-for="mode in THEMES" :key="mode" class="demo-settings__segment">
          <input
            type="radio"
            :name="`${uid}-theme`"
            :value="mode"
            :checked="colorMode === mode"
            @change="emit('update:colorMode', mode)"
          />
          <span>
            <DemoIcon :name="mode === 'light' ? 'sun' : 'moon'" />
            {{ t(`demoPanel.theme.${mode}`) }}
          </span>
        </label>
      </div>
    </fieldset>
    <fieldset class="demo-settings__group">
      <legend>{{ t('demoPanel.view') }}</legend>
      <label class="demo-settings__switch">
        <span>{{ t('demoPanel.rulers') }}</span>
        <input
          type="checkbox"
          :checked="rulers"
          @change="emit('update:rulers', ($event.target as HTMLInputElement).checked)"
        />
      </label>
    </fieldset>
    <div class="demo-settings__group">
      <label class="demo-settings__label" :for="`${uid}-language`">
        {{ t('reviewSettings.language') }}
      </label>
      <select
        :id="`${uid}-language`"
        class="demo-settings__select"
        :value="language"
        :aria-describedby="`${uid}-language-help`"
        @change="onLanguage"
      >
        <option
          v-for="item in DEMO_LANGUAGES"
          :key="item.code"
          :value="item.code"
          :lang="item.code"
        >
          {{ item.name }}
        </option>
      </select>
      <p :id="`${uid}-language-help`" class="demo-settings__help">
        {{ t('reviewSettings.languageHelp') }}
      </p>
    </div>
    <fieldset
      v-for="group in REVIEW_SETTINGS_GROUPS"
      :key="group.field"
      class="demo-settings__group"
      :aria-describedby="helpOf(group) ? `${uid}-${group.field}-help` : undefined"
    >
      <legend>{{ t(group.label) }}</legend>
      <div class="demo-settings__segments" :data-count="group.options.length">
        <label v-for="option in group.options" :key="option.value" class="demo-settings__segment">
          <input
            type="radio"
            :name="`${uid}-${group.field}`"
            :value="option.value"
            :checked="pane[group.field] === option.value"
            :disabled="!editor"
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
    <button
      type="button"
      class="demo-settings__reset"
      :disabled="!editor"
      @click="apply(EXAMPLE_REVIEW_PANE, false)"
    >
      {{ t('reviewSettings.reset') }}
    </button>
  </div>
</template>

<script setup lang="ts">
// The Settings tab of the side panel: the theme, the rulers, the interface language, and how comments and
// tracked changes appear. The Vue twin of the React example's `ReviewSettings.tsx`. The model
// is shared in `examples/shared/review-settings.ts`. Every review control writes through
// `editor.setReviewPaneOptions()` and reads back from `snapshot.reviewPane`.
import { useId } from 'vue';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/vue';
import type { ResolvedReviewPane, ReviewPaneOptions } from '@docx-editor.dev/core/editor';
import { exampleText as t } from '../../shared/example-text';
import {
  EXAMPLE_REVIEW_PANE,
  REVIEW_SETTINGS_GROUPS,
  reviewSettingsHelp,
  saveReviewPane,
  type ReviewSettingsGroup,
} from '../../shared/review-settings';
import type { LocaleCode } from '@docx-editor.dev/i18n';
import { DEMO_LANGUAGES, demoLanguage, switchDemoLanguage } from '../../shared/demo-language';
import DemoIcon from './DemoIcon.vue';
import '../../shared/review-settings.css';

defineProps<{
  colorMode: 'light' | 'dark';
  /** Whether the rulers show. */
  rulers: boolean;
}>();
const emit = defineEmits<{
  'update:colorMode': [value: 'light' | 'dark'];
  'update:rulers': [show: boolean];
}>();

const THEMES = ['light', 'dark'] as const;

const ICON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
} as const;

const editor = useDocxEditor();
const pane = useEditorState((snapshot) => snapshot.reviewPane);
const language = demoLanguage();
const onLanguage = (event: Event) =>
  switchDemoLanguage((event.target as HTMLSelectElement).value as LocaleCode);
const uid = `review-settings-${useId()}`;

const helpOf = (group: ReviewSettingsGroup) => reviewSettingsHelp(group, pane.value[group.field]);

function apply(options: ReviewPaneOptions | ResolvedReviewPane, save: boolean): void {
  const instance = editor.value;
  if (!instance) return;
  instance.setReviewPaneOptions(options);
  saveReviewPane(save ? instance.snapshot().reviewPane : null);
}
</script>
