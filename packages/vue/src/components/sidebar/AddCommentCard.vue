<template>
  <div class="add-comment-card" @mousedown.stop>
    <textarea
      ref="inputRef"
      v-model="text"
      class="add-comment-card__input"
      placeholder="Add a comment..."
      rows="2"
      @keydown.enter.exact.prevent="submit"
      @keydown.escape="$emit('cancel')"
    />
    <div class="add-comment-card__footer">
      <button class="add-comment-card__cancel" @mousedown.prevent="$emit('cancel')">Cancel</button>
      <button
        class="add-comment-card__submit"
        :disabled="!text.trim()"
        @mousedown.prevent="submit"
      >Comment</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

const emit = defineEmits<{
  (e: 'submit', text: string): void;
  (e: 'cancel'): void;
}>();

const inputRef = ref<HTMLTextAreaElement | null>(null);
const text = ref('');

function submit() {
  const t = text.value.trim();
  if (!t) return;
  emit('submit', t);
  text.value = '';
}

onMounted(() => {
  inputRef.value?.focus();
});
</script>

<style scoped>
.add-comment-card {
  background: #fff;
  border: 2px solid #1a73e8;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 6px;
}
.add-comment-card__input {
  width: 100%;
  border: none;
  outline: none;
  font-size: 13px;
  font-family: inherit;
  resize: none;
  color: #1f2937;
}
.add-comment-card__footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}
.add-comment-card__cancel {
  padding: 5px 14px;
  border: none;
  background: transparent;
  color: #1a73e8;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  border-radius: 4px;
}
.add-comment-card__cancel:hover { background: #f0f4ff; }
.add-comment-card__submit {
  padding: 5px 14px;
  border: none;
  border-radius: 16px;
  background: #1a73e8;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.add-comment-card__submit:disabled {
  background: #e5e7eb;
  color: #9ca3af;
  cursor: default;
}
</style>
