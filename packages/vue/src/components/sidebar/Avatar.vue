<!--
  Tiny avatar bubble used by every sidebar card. Centralises the
  bg-color hash + initials extraction; previously each of CommentCard,
  TrackedChangeCard, and ReplyThread bound `:style="avatarStyle(...)"`
  inline via a shared helper, but the call site repetition was noisy.

  The helper itself (avatarStyle, getInitials, getAvatarColor) still
  lives in sidebarUtils so external consumers can call it directly.
-->
<template>
  <div class="docx-avatar" :style="style">
    {{ initials }}
  </div>
</template>

<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import { getInitials, getAvatarColor } from './sidebarUtils';

const props = withDefaults(
  defineProps<{
    name?: string | null;
    size?: 32 | 28;
  }>(),
  { name: 'U', size: 32 }
);

const initials = computed(() => getInitials(props.name || 'U'));

const style = computed<CSSProperties>(() => ({
  width: props.size + 'px',
  height: props.size + 'px',
  borderRadius: '50%',
  backgroundColor: getAvatarColor(props.name || 'U'),
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: props.size === 32 ? '13px' : '11px',
  fontWeight: 500,
  flexShrink: 0,
}));
</script>
