<!--
  Mirror of packages/react/src/components/sidebar/ReplyInput.tsx.
  Read-only "Reply" input that activates on click; active state shows
  blue border + Cancel/Reply buttons. Enter submits, Escape cancels.
-->
<template>
  <div @click.stop @mousedown.stop class="reply-input">
    <input
      v-if="!active"
      readonly
      placeholder="Reply"
      class="reply-input__field reply-input__field--inactive"
      @mousedown.stop
      @click.stop="activate"
    />
    <template v-else>
      <input
        ref="inputRef"
        v-model="text"
        type="text"
        placeholder="Reply"
        class="reply-input__field reply-input__field--active"
        @mousedown.stop
        @keydown.stop
        @keydown.enter.prevent="submitAndClose"
        @keydown.esc="cancel"
      />
      <div class="reply-input__actions">
        <button class="reply-input__cancel" @click.stop="cancel">Cancel</button>
        <button
          class="reply-input__submit"
          :class="{ 'reply-input__submit--active': trimmed }"
          :disabled="!trimmed"
          @click.stop="submitAndClose"
        >Reply</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';

const emit = defineEmits<{
  (e: 'submit', text: string): void;
}>();

const active = ref(false);
const text = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

const trimmed = computed(() => text.value.trim());

function activate() {
  active.value = true;
  nextTick(() => inputRef.value?.focus({ preventScroll: true }));
}

function cancel() {
  active.value = false;
  text.value = '';
}

function submitAndClose() {
  const value = trimmed.value;
  if (value) emit('submit', value);
  text.value = '';
  active.value = false;
}
</script>

<style scoped>
.reply-input { margin-top: 12px; }
.reply-input__field {
  width: 100%;
  border-radius: 20px;
  outline: none;
  font-size: 14px;
  padding: 8px 16px;
  font-family: inherit;
  box-sizing: border-box;
}
.reply-input__field--inactive {
  border: 1px solid #dadce0;
  color: #80868b;
  cursor: text;
  background: #fff;
}
.reply-input__field--active {
  border: 1px solid #1a73e8;
  color: #202124;
  background: #fff;
}
.reply-input__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.reply-input__cancel {
  padding: 6px 16px;
  font-size: 14px;
  border: none;
  background: none;
  color: #1a73e8;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
}
.reply-input__submit {
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
.reply-input__submit--active {
  background: #1a73e8;
  color: #fff;
  cursor: pointer;
}
</style>
