import { useCallback, useRef, useState } from 'react';

/**
 * A boolean that can run either controlled or uncontrolled, with a setter that
 * keeps the identity React's `useState` setter has.
 *
 * - Controlled (`controlled` is a boolean): the prop is the source of truth.
 *   Internal state is bypassed and the setter only emits the next value through
 *   `onChange` — the consumer decides whether to honor it.
 * - Uncontrolled (`controlled` is `undefined`): the hook owns the value, and the
 *   setter updates internal state and emits through `onChange` so consumers can
 *   observe without owning state.
 *
 * Unlike the inline controlled-prop patterns elsewhere in `DocxEditor`, the
 * returned setter is a stable `Dispatch<SetStateAction<boolean>>`: it accepts
 * functional updates (`(v) => !v`) and never changes identity, so it is safe to
 * pass into memoized child hooks and dependency arrays. `onChange` does not fire
 * when the value would be unchanged.
 */
export function useControllableBoolean(
  controlled: boolean | undefined,
  onChange?: (value: boolean) => void,
  defaultValue = false
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const isControlled = controlled !== undefined;
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const value = isControlled ? controlled : uncontrolled;

  // Refs let the stable setter read the latest value (for functional updates)
  // and callback without being re-created.
  const valueRef = useRef(value);
  valueRef.current = value;
  const isControlledRef = useRef(isControlled);
  isControlledRef.current = isControlled;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const setValue = useCallback<React.Dispatch<React.SetStateAction<boolean>>>((update) => {
    const prev = valueRef.current;
    const next = typeof update === 'function' ? update(prev) : update;
    if (next === prev) return;
    // Only mutate the ref optimistically when uncontrolled. When controlled the
    // per-render assignment above keeps it in sync with the prop, so we stay
    // correct even if the consumer ignores this change.
    if (!isControlledRef.current) {
      valueRef.current = next;
      setUncontrolled(next);
    }
    onChangeRef.current?.(next);
  }, []);

  return [value, setValue];
}
