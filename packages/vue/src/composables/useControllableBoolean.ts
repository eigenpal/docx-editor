import { computed, ref, type WritableComputedRef } from 'vue';

/**
 * A boolean that can run either controlled or uncontrolled, exposed as a
 * writable ref so existing call sites can keep mutating `.value` directly.
 *
 * - Controlled (`controlled()` returns a boolean): the prop is the source of
 *   truth. Internal state is bypassed; writes only call `onChange` (if provided)
 *   and the consumer decides whether to honor them.
 * - Uncontrolled (`controlled()` returns `undefined`): the composable owns the
 *   value, and writes update internal state and call `onChange` so consumers can
 *   observe without owning state.
 *
 * `onChange` is optional and does not fire when the value would be unchanged.
 * Mirrors the React adapter's `useControllableBoolean` hook.
 */
export function useControllableBoolean(
  controlled: () => boolean | undefined,
  onChange?: (value: boolean) => void,
  defaultValue = false
): WritableComputedRef<boolean> {
  const internal = ref(defaultValue);
  return computed<boolean>({
    get() {
      const c = controlled();
      return c !== undefined ? c : internal.value;
    },
    set(next) {
      const c = controlled();
      const prev = c !== undefined ? c : internal.value;
      if (next === prev) return;
      if (c === undefined) internal.value = next;
      onChange?.(next);
    },
  });
}
