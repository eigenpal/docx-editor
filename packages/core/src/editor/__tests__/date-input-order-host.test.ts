import { expect, test } from 'bun:test';
import {
  createDocxEditorHostConfigState,
  liveHostConfigSetters,
} from '../docx-editor-host-config.ts';
test('invalid runtime date order uses the stable default without poisoning field commands', () => {
  const invalid = 'en-GB' as 'mdy';
  const state = createDocxEditorHostConfigState({ dateInputOrder: invalid });
  expect(state.dateInputOrder()).toBe('mdy');
  let applied = '';
  const setters = liveHostConfigSetters(state, {
    surface: () => ({
      setDrawingStrings() {},
      setTocLabels() {},
      setDateInputOrder(order) {
        applied = order;
      },
    }),
    bump() {},
    emitSelectionChange() {},
  });
  setters.setDateInputOrder('dmy');
  expect(state.dateInputOrder()).toBe('dmy');
  setters.setDateInputOrder(invalid);
  expect(state.dateInputOrder()).toBe('mdy');
  expect(applied).toBe('mdy');
});
