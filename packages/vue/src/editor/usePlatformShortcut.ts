// Shortcut labels that name the reader's own modifier keys, without breaking hydration.
//
// `platformShortcut` reads `navigator`, which does not exist on a server. Called straight
// from a render function, that makes the server emit "Bold (Ctrl+B)" and a Mac client render
// "Bold (⌘+B)" — a hydration mismatch on an `aria-label`, a `title` and a menu row's text.
//
// So the first render answers as the server did, and `onMounted` — which runs only on the
// client, after hydration has matched — flips it. The ref never changes again; a keyboard
// does not become a different platform.

import { onMounted, ref, type Ref } from 'vue';
import { platformShortcut } from '@docx-editor.dev/i18n';

/**
 * A label formatter that names the modifier keys this reader's keyboard has.
 *
 * @internal
 */
export function usePlatformShortcut(): (text: string) => string {
  const resolved: Ref<boolean> = ref(false);
  onMounted(() => {
    resolved.value = true;
  });
  return (text: string) => (resolved.value ? platformShortcut(text) : text);
}
