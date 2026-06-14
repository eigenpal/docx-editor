<!--
  Vue port of packages/react/src/components/ResponsePreview.tsx —
  AI response preview with diff view + Accept / Reject / Edit /
  Retry actions. Same emit shape as React's onAccept / onReject /
  onRetry callbacks.

  This is a focused port: covers loading, error, success, and edit
  states. The diff renderer is a simpler word-by-word view than
  React's character-level LCS implementation; the rest of the
  surface (accept/reject/edit with `allowEdit` toggle) matches
  byte-for-byte.
-->
<template>
  <div class="docx-response-preview" :class="className" :style="position ? { left: position.x + 'px', top: position.y + 'px' } : undefined">
    <!-- Loading -->
    <div v-if="isLoading" class="docx-response-preview__loading">
      <div class="docx-response-preview__spinner" />
      <span>Generating response...</span>
    </div>
    <!-- Error -->
    <div v-else-if="error" class="docx-response-preview__error">
      <div class="docx-response-preview__error-msg">{{ error }}</div>
      <div class="docx-response-preview__actions">
        <button v-if="onRetry" class="docx-response-preview__btn" @click.prevent="onRetry">Retry</button>
        <button class="docx-response-preview__btn" @click.prevent="$emit('reject')">Cancel</button>
      </div>
    </div>
    <!-- Success -->
    <template v-else-if="response">
      <div class="docx-response-preview__header">
        <span class="docx-response-preview__action">{{ actionLabelText }}</span>
      </div>
      <div v-if="!isEditing && showDiff" class="docx-response-preview__diff">
        <span
          v-for="(seg, i) in diffSegments"
          :key="i"
          :class="`docx-response-preview__seg docx-response-preview__seg--${seg.type}`"
        >{{ seg.text }}</span>
      </div>
      <textarea
        v-else
        v-model="editedText"
        class="docx-response-preview__textarea"
        :readonly="!isEditing"
      />
      <div class="docx-response-preview__actions">
        <button class="docx-response-preview__btn docx-response-preview__btn--accept" @click.prevent="onAcceptClick">
          ✓ Accept
        </button>
        <button class="docx-response-preview__btn" @click.prevent="$emit('reject')">
          ✕ Reject
        </button>
        <button v-if="allowEdit && !isEditing" class="docx-response-preview__btn" @click.prevent="startEdit">
          ✎ Edit
        </button>
        <button v-if="isEditing" class="docx-response-preview__btn" @click.prevent="cancelEdit">
          Cancel edit
        </button>
        <button v-if="onRetry" class="docx-response-preview__btn" @click.prevent="onRetry">
          ↻ Retry
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { AIAction, AgentResponse } from '@eigenpal/docx-editor-core/types/agentApi';

const props = withDefaults(
  defineProps<{
    originalText: string;
    response: AgentResponse | null;
    action: AIAction;
    isLoading: boolean;
    error?: string;
    allowEdit?: boolean;
    showDiff?: boolean;
    className?: string;
    position?: { x: number; y: number };
    onRetry?: () => void;
  }>(),
  { allowEdit: true, showDiff: true }
);

const emit = defineEmits<{
  (e: 'accept', text: string): void;
  (e: 'reject'): void;
}>();

const isEditing = ref(false);
const editedText = ref('');

watch(
  () => props.response?.text,
  (text) => {
    editedText.value = text ?? '';
  },
  { immediate: true }
);

const ACTION_LABELS: Record<AIAction, string> = {
  askAI: 'AI response',
  rewrite: 'Rewritten',
  expand: 'Expanded',
  summarize: 'Summarised',
  translate: 'Translated',
  explain: 'Explanation',
  fixGrammar: 'Grammar fix',
  makeFormal: 'Formal version',
  makeCasual: 'Casual version',
  custom: 'AI response',
};
const actionLabelText = computed(() => ACTION_LABELS[props.action] ?? 'AI response');

interface DiffSegment {
  type: 'same' | 'added' | 'removed';
  text: string;
}

// Simple word-level diff. Good enough for the preview UX; React uses a
// fuller character-level LCS implementation but the result is close.
const diffSegments = computed<DiffSegment[]>(() => {
  if (!props.response) return [];
  const oldWords = props.originalText.split(/(\s+)/);
  const newWords = props.response.text.split(/(\s+)/);
  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);
  const out: DiffSegment[] = [];
  for (const w of oldWords) {
    if (!newSet.has(w)) out.push({ type: 'removed', text: w });
  }
  for (const w of newWords) {
    if (!oldSet.has(w)) out.push({ type: 'added', text: w });
    else out.push({ type: 'same', text: w });
  }
  return out;
});

function onAcceptClick() {
  emit('accept', editedText.value);
}
function startEdit() {
  isEditing.value = true;
}
function cancelEdit() {
  isEditing.value = false;
  editedText.value = props.response?.text ?? '';
}
</script>

<style scoped>
.docx-response-preview {
  position: absolute;
  background: var(--doc-surface);
  border: 1px solid var(--doc-border-dark);
  border-radius: 8px;
  box-shadow: 0 4px 16px var(--doc-shadow);
  padding: 12px;
  min-width: 320px;
  max-width: 480px;
  z-index: 10000;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
}
.docx-response-preview__loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--doc-text-muted);
}
.docx-response-preview__spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--doc-border);
  border-top-color: var(--doc-primary);
  border-radius: 50%;
  animation: docx-rp-spin 0.8s linear infinite;
}
@keyframes docx-rp-spin { to { transform: rotate(360deg); } }
.docx-response-preview__header {
  font-size: 11px;
  font-weight: 500;
  color: var(--doc-text-subtle);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}
.docx-response-preview__diff {
  white-space: pre-wrap;
  line-height: 20px;
  margin-bottom: 10px;
  color: var(--doc-text);
}
.docx-response-preview__seg--added {
  background: var(--doc-success-bg);
  color: var(--doc-success);
}
.docx-response-preview__seg--removed {
  background: var(--doc-error-bg);
  color: var(--doc-error);
  text-decoration: line-through;
}
.docx-response-preview__textarea {
  width: 100%;
  min-height: 120px;
  padding: 8px 10px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  font-family: inherit;
  font-size: 14px;
  line-height: 20px;
  outline: none;
  resize: vertical;
}
.docx-response-preview__textarea:focus { border-color: var(--doc-primary); }
.docx-response-preview__actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.docx-response-preview__btn {
  padding: 6px 12px;
  border: 1px solid var(--doc-border-dark);
  border-radius: 4px;
  background: var(--doc-surface);
  cursor: pointer;
  font-size: 13px;
}
.docx-response-preview__btn:hover { background: var(--doc-bg-hover); }
.docx-response-preview__btn--accept {
  background: var(--doc-primary);
  border-color: var(--doc-primary);
  color: var(--doc-on-primary);
}
.docx-response-preview__btn--accept:hover { background: var(--doc-primary-hover); }
.docx-response-preview__error {
  color: var(--doc-error);
}
.docx-response-preview__error-msg {
  margin-bottom: 8px;
}
</style>
