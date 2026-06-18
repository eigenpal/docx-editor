import { describe, test, expect, mock } from 'bun:test';
import { ref } from 'vue';
import { useControllableBoolean } from './useControllableBoolean';

/**
 * Parity with the React adapter's useControllableBoolean hook test. The
 * controlled source is a `ref` so the writable `computed` tracks it the way it
 * tracks a reactive `props.commentsSidebarOpen` in the SFC.
 */
describe('useControllableBoolean', () => {
  test('uncontrolled: owns state, updates value, and reports through onChange', () => {
    const onChange = mock((_v: boolean) => {});
    const controlled = ref<boolean | undefined>(undefined);
    const open = useControllableBoolean(() => controlled.value, onChange);

    expect(open.value).toBe(false);

    open.value = true;
    expect(open.value).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);

    open.value = false;
    expect(open.value).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  test('uncontrolled: respects a non-default initial value with no onChange', () => {
    const open = useControllableBoolean(() => undefined, undefined, true);
    expect(open.value).toBe(true);
    // Writing without an onChange handler must not throw.
    open.value = false;
    expect(open.value).toBe(false);
  });

  test('controlled: prop is the source of truth; writes do not change the value', () => {
    const onChange = mock((_v: boolean) => {});
    const controlled = ref<boolean | undefined>(false);
    const open = useControllableBoolean(() => controlled.value, onChange);

    expect(open.value).toBe(false);

    // Requesting open emits but does not change the rendered value; the consumer
    // drives it via the prop.
    open.value = true;
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(open.value).toBe(false);

    // Consumer honors the change.
    controlled.value = true;
    expect(open.value).toBe(true);
  });

  test('does not fire onChange when the value would not change', () => {
    const onChange = mock((_v: boolean) => {});
    const open = useControllableBoolean(() => undefined, onChange);

    open.value = false;
    expect(onChange).not.toHaveBeenCalled();
  });
});
