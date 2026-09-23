import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { h } from 'vue';
import { DocxEditorToolbar } from '../src/editor/toolbar';
import { flush, mountEditorTree } from './helpers/mount';
import { PICKER_SOURCE } from './helpers/picker-document';
async function update(action: () => unknown = () => {}) { action(); await flush(); }
async function mount() {
  const view = mountEditorTree(() => h(DocxEditorToolbar, { preset: false, overflow: false }, {
    default: () => [h(DocxEditorToolbar.FontFamily), h(DocxEditorToolbar.StylePicker),
      h(DocxEditorToolbar.Zoom), h(DocxEditorToolbar.FontSize),
      h(DocxEditorToolbar.FontColor), h(DocxEditorToolbar.Highlight)],
  }), PICKER_SOURCE);
  await flush();
  return view;
}

afterEach(() => { unmount?.(); unmount = undefined; });
let unmount: (() => void) | undefined;

for (const slot of ['font.family', 'styles.style', 'zoom.level']) {
  test(`${slot}: named options support arrows, Escape, and focus return`, async () => {
    const view = await mount();
    unmount = view.unmount;
    const root = view.container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    expect(trigger.disabled).toBe(false);
    const visible = trigger.textContent!.replace('▾', '').trim();
    const name = trigger.getAttribute('aria-label') ?? trigger.textContent!;
    expect(name).toContain(visible);
    await update(() => { trigger.focus(); trigger.click(); });
    const list = root.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(list).not.toBeNull();
    expect(list.getAttribute('aria-label')?.length).toBeGreaterThan(0);
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options.length).toBeGreaterThan(1);
    expect(options.every(option => option.tabIndex === -1)).toBe(true);
    await update(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(options[0]);
    await update(() => options[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(options.at(-1)!);
    await update(() => options.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
}

test('font size links its open list and color pickers return focus on Escape', async () => {
  const view = await mount();
  unmount = view.unmount;
  const size = view.container.querySelector<HTMLInputElement>('[data-slot="font.size"] input')!;
  await update(() => size.focus());
  const list = view.container.querySelector('[data-slot="font.size"] [role="listbox"]')!;
  expect(size.getAttribute('aria-controls')).toBe(list.id);
  expect(list.id.length).toBeGreaterThan(0);
  for (const slot of ['text.color', 'text.highlight']) {
    const root = view.container.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
    const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup]')!;
    await update(() => { trigger.focus(); trigger.click(); });
    const dialog = root.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    const option = dialog.querySelector<HTMLButtonElement>('button')!;
    await update(() => { option.focus(); option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await update(() => trigger.click());
    const swatch = root.querySelector<HTMLButtonElement>('[role="dialog"] button')!;
    await update(() => { swatch.focus(); swatch.click(); });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(view.container.querySelector('.docx-pages'));
  }
});
