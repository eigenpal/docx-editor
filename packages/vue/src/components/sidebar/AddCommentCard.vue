<!--
  Mirror of packages/react/src/components/sidebar/AddCommentCard.tsx.
  White card with stronger shadow + a textarea sized for short
  comments + Cancel/Comment buttons matching ReplyInput's button
  styling.
-->
<template>
  <div class="add-comment-card" @mousedown.stop>
    <textarea
      ref="inputRef"
      v-model="text"
      class="add-comment-card__field"
      placeholder="Add a comment"
      @mousedown.stop
      @keydown.stop
      @keydown.enter.exact.prevent="handleSubmit"
      @keydown.esc="handleCancel"
    />
    <div class="add-comment-card__actions">
      <button class="add-comment-card__cancel" @click="handleCancel">Cancel</button>
      <button
        class="add-comment-card__submit"
        :class="{ 'add-comment-card__submit--active': trimmed }"
        :disabled="!trimmed"
        @click="handleSubmit"
      >Comment</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

const emit = defineEmits<{
  (e: 'submit', text: string): void;
  (e: 'cancel'): void;
}>();

const text = ref('');
const inputRef = ref<HTMLTextAreaElement | null>(null);

const trimmed = computed(() => text.value.trim());

onMounted(() => {
  inputRef.value?.focus({ preventScroll: true });
});

function handleSubmit() {
  if (trimmed.value) {
    emit('submit', trimmed.value);
    text.value = '';
  }
}

function handleCancel() {
  emit('cancel');
  text.value = '';
}
</script>

<style scoped>
.add-comment-card {
  padding: 12px;
  border-radius: 8px;
  background: #fff;
  box-shadow:
    0 1px 3px rgba(60, 64, 67, 0.3),
    0 4px 8px 3px rgba(60, 64, 67, 0.15);
  z-index: 50;
  margin-bottom: 6px;
}
.add-comment-card__field {
  width: 100%;
  border: 1px solid #1a73e8;
  border-radius: 20px;
  outline: none;
  resize: none;
  font-size: 14px;
  line-height: 20px;
  padding: 8px 16px;
  font-family: inherit;
  min-height: 40px;
  box-sizing: border-box;
  color: #202124;
}
.add-comment-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.add-comment-card__cancel {
  padding: 6px 16px;
  font-size: 14px;
  border: none;
  background: none;
  color: #1a73e8;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
}
.add-comment-card__submit {
  padding: 6px 16px;
  font-size: 14px;
  border: none;
  border-radius: 20px;
  background: #f1f3f4;
  color: #80868b;
  cursor: default;
  font-weight: 500;
  font-family: inherit;
}
.add-comment-card__submit--active {
  background: #1a73e8;
  color: #fff;
  cursor: pointer;
}
</style>
