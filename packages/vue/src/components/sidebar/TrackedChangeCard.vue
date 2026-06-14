<!--
  Mirror of packages/react/src/components/sidebar/TrackedChangeCard.tsx.
  Same chrome (collapsed/expanded), same author/date layout,
  insertion/deletion/replacement formatting, accept/reject icon
  buttons in expanded state.
-->
<template>
  <div
    class="tc-card"
    :class="{ 'tc-card--expanded': expanded }"
    @click="$emit('click')"
    @mousedown.stop
  >
    <div class="tc-card__head">
      <Avatar :name="authorName" :size="32" />
      <div class="tc-card__author-block">
        <div class="tc-card__author">{{ authorName }}</div>
        <div v-if="change.date" class="tc-card__date">{{ formatDate(change.date) }}</div>
      </div>
      <div v-if="expanded" class="tc-card__actions">
        <button class="tc-card__icon-btn" :title="t('common.accept')" @click.stop="onAccept">
          <MaterialSymbol name="check" :size="20" />
        </button>
        <button class="tc-card__icon-btn" :title="t('common.reject')" @click.stop="onReject">
          <MaterialSymbol name="close" :size="20" />
        </button>
      </div>
    </div>

    <div class="tc-card__body">
      <template v-if="change.type === 'replacement'">
        {{ t('trackedChanges.replaced') }}
        <span class="tc-card__deleted"
          >&quot;{{ truncateText(change.deletedText || '') }}&quot;</span
        >
        {{ t('trackedChanges.with') }}
        <span class="tc-card__inserted">&quot;{{ truncateText(change.text) }}&quot;</span>
      </template>
      <template v-else-if="change.type === 'paragraphMarkInsertion'">
        {{ t('revisions.paragraphMarkInserted')
        }}<template v-if="change.text"
          >:
          <span class="tc-card__inserted"
            >&quot;{{ truncateText(change.text) }}&quot;</span
          ></template
        >
      </template>
      <template v-else-if="change.type === 'paragraphMarkDeletion'">
        {{ t('revisions.paragraphMarkDeleted')
        }}<template v-if="change.text"
          >:
          <span class="tc-card__deleted"
            >&quot;{{ truncateText(change.text) }}&quot;</span
          ></template
        >
      </template>
      <template v-else-if="change.type === 'paragraphPropertiesChanged'">
        {{ t('revisions.paragraphPropertiesChanged')
        }}<template v-if="change.text"
          >:
          <span class="tc-card__changed"
            >&quot;{{ truncateText(change.text) }}&quot;</span
          ></template
        >
      </template>
      <template v-else-if="change.type === 'rowInserted'">
        <span class="tc-card__inserted">{{ t('revisions.rowInserted') }}</span>
      </template>
      <template v-else-if="change.type === 'rowDeleted'">
        <span class="tc-card__deleted">{{ t('revisions.rowDeleted') }}</span>
      </template>
      <template v-else-if="change.type === 'cellInserted'">
        <span class="tc-card__inserted">{{ t('revisions.cellInserted') }}</span>
      </template>
      <template v-else-if="change.type === 'cellDeleted'">
        <span class="tc-card__deleted">{{ t('revisions.cellDeleted') }}</span>
      </template>
      <template v-else-if="change.type === 'cellMerged'">
        <span class="tc-card__changed">{{ t('revisions.cellMerged') }}</span>
      </template>
      <template v-else-if="change.type === 'rowPropertiesChanged'">
        <span class="tc-card__changed">{{ t('revisions.rowPropertiesChanged') }}</span>
      </template>
      <template v-else-if="change.type === 'cellPropertiesChanged'">
        <span class="tc-card__changed">{{ t('revisions.cellPropertiesChanged') }}</span>
      </template>
      <template v-else-if="change.type === 'tablePropertiesChanged'">
        <span class="tc-card__changed">{{ t('revisions.tablePropertiesChanged') }}</span>
      </template>
      <template v-else-if="change.type === 'tableInserted'">
        <span class="tc-card__inserted">{{ t('revisions.tableInserted') }}</span>
      </template>
      <template v-else-if="change.type === 'tableDeleted'">
        <span class="tc-card__deleted">{{ t('revisions.tableDeleted') }}</span>
      </template>
      <template v-else>
        {{ change.type === 'insertion' ? t('trackedChanges.added') : t('trackedChanges.deleted') }}
        <span :class="change.type === 'insertion' ? 'tc-card__inserted' : 'tc-card__deleted'">
          &quot;{{ truncateText(change.text) }}&quot;
        </span>
      </template>
    </div>

    <!-- Threaded replies + reply input — mirrors React
         TrackedChangeCard.tsx. Replies are child comments keyed by
         parentId === revisionId. -->
    <ReplyThread :replies="replies" :is-expanded="expanded" />

    <ReplyInput
      v-if="expanded"
      @submit="(text: string) => $emit('reply', change.revisionId, text)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Comment } from '@eigenpal/docx-editor-core/types/content';
import type { TrackedChangeEntry } from './sidebarUtils';
import { formatDate, truncateText } from './sidebarUtils';
import Avatar from './Avatar.vue';
import MaterialSymbol from '../ui/MaterialSymbol.vue';
import ReplyThread from './ReplyThread.vue';
import ReplyInput from './ReplyInput.vue';
import { useTranslation } from '../../i18n';

const { t } = useTranslation();

// `replies` is always supplied by UnifiedSidebar (`item.replies ?? []`),
// matching the sibling CommentCard. Required, like React's TrackedChangeCard.
const props = defineProps<{
  change: TrackedChangeEntry;
  expanded: boolean;
  replies: Comment[];
}>();

const emit = defineEmits<{
  (e: 'click'): void;
  (e: 'accept-by-id', revisionId: number): void;
  (e: 'reject-by-id', revisionId: number): void;
  (e: 'reply', revisionId: number, text: string): void;
}>();

const authorName = computed(() => props.change.author || t('trackedChanges.unknown'));

// Dispatch by `revisionId` whenever the host wired the by-id channel.
// Walks every id the card represents: the primary, the replacement's
// distinct insertion id, plus any ids the extractor merged in via
// (author, date) coalescing.
function allRevisionIds(): number[] {
  const ids = new Set<number>([props.change.revisionId]);
  if (props.change.type === 'replacement' && props.change.insertionRevisionId != null) {
    ids.add(props.change.insertionRevisionId);
  }
  for (const id of props.change.coalescedRevisionIds ?? []) ids.add(id);
  return [...ids];
}

function onAccept() {
  for (const id of allRevisionIds()) emit('accept-by-id', id);
}

function onReject() {
  for (const id of allRevisionIds()) emit('reject-by-id', id);
}
</script>

<style scoped>
.tc-card {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--doc-card);
  cursor: pointer;
  box-shadow: var(--doc-card-shadow);
  margin-bottom: 6px;
  transition:
    box-shadow 0.15s ease,
    background-color 0.15s ease,
    padding 0.15s ease;
}
.tc-card--expanded {
  padding: 10px 12px;
  background: var(--doc-surface);
  box-shadow: var(--doc-card-shadow-strong);
}
.tc-card__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.tc-card__author-block {
  flex: 1;
  min-width: 0;
}
.tc-card__author {
  font-size: 13px;
  font-weight: 600;
  color: var(--doc-text);
}
.tc-card__date {
  font-size: 11px;
  color: var(--doc-text-muted);
}
.tc-card__actions {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}
.tc-card__icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--doc-text-muted);
  display: flex;
  border-radius: 50%;
}
.tc-card__icon-btn:hover {
  background: var(--doc-shadow-subtle);
}
.tc-card__body {
  font-size: 13px;
  line-height: 20px;
  color: var(--doc-text);
  margin-top: 6px;
}
.tc-card__deleted {
  color: var(--doc-error);
  font-weight: 500;
}
.tc-card__inserted {
  color: var(--doc-success);
  font-weight: 500;
}
.tc-card__changed {
  color: var(--doc-text-muted);
  font-weight: 500;
}
</style>
