// Toolbar (interactive-paginated-editing M5.1, extended to full chrome parity at M6V.1).
//
// The Vue counterpart of React's `DocxEditorToolbar.tsx`, sharing the engine's
// can-before-exec wiring so the two toolbars cannot drift on when a control is
// enabled. Every control's enabled state is one `Editor.can(command)` answer; a
// click runs `Editor.exec(command)` only after `can` said yes; save calls
// `Editor.save()` directly. A control the engine cannot honour renders disabled
// with the engine's own reason as its tooltip.
//
// Groups, ordering, icons, and i18n keys come from `CHROME_GROUPS` in
// engine-editor — the same data React renders, so the two cannot diverge on the
// chrome itself either. Two divergences this file previously carried are fixed
// here: it defaulted `showSave` to true where React rendered save only when a
// handler was supplied, and it hardcoded English labels.

import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import {
  CHROME_UNAVAILABLE_KEY,
  chromeSlotId,
  defaultChromeGroups,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeControl,
  type ChromeSlotId,
} from '@docx-editor.dev/core-contract/editor';
import { useEditorSnapshot } from './useEditorSnapshot';

/**
 * Resolves an i18n key to display text.
 *
 * Required, not optional with an English fallback: `packages/i18n/en.json` is the
 * repo's single source of truth for user-facing strings, and CLAUDE.md forbids
 * hardcoded user-facing English in components. The adapter only holds keys.
 */
export type Translate = (key: string) => string;

export interface DocxEditorToolbarProps {
  readonly editor: Editor | null;
  readonly t: Translate;
  readonly onSave?: () => void;
}

function icon(paths: readonly string[]): VNode {
  return h(
    'svg',
    {
      viewBox: '0 -960 960 960',
      width: '18',
      height: '18',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    paths.map((d) => h('path', { key: d, d, fill: 'currentColor' }))
  );
}

/**
 * Whether THIS TOOLBAR can dispatch a control — a fact about the adapter, never about
 * the engine.
 *
 * A value-typed slot needs chrome that produces a value (a font list, a size, a colour)
 * before a click means anything, and the non-icon shapes need that chrome too; this
 * toolbar has grown none of it yet, so those controls render as their shape's disabled
 * lookalike. EVERYTHING ELSE asks `toolbarCommandState`, so the engine — not this file —
 * decides what is enabled, and a command the engine wires lights up in both adapters at
 * once.
 *
 * This used to read the registry's `state.kind === 'parityOnly'`, a static claim that
 * had gone stale for twelve wired slots: underline, strike, the four alignments, the
 * four list controls and the four value slots all ran fine in React while Vue drew them
 * permanently disabled.
 */
function isDrivenHere(c: ChromeControl): boolean {
  return c.state.kind === 'command' && (c.shape ?? 'icon') === 'icon';
}

function control(
  editor: Editor | null,
  slotId: ChromeSlotId,
  c: ChromeControl,
  t: Translate,
  onSave: (() => void) | undefined
): VNode {
  const label = t(c.labelKey);

  // Save first: it IS driven here, just not as a command (`Editor.save()` returns bytes
  // the host must deliver), so it must not fall into the undriven branches below.
  if (c.state.kind === 'save') {
    return h(
      'button',
      {
        key: c.id,
        type: 'button',
        class: 'ep-toolbar__button',
        'data-testid': `toolbar-${slotId}`,
        disabled: !editor || !onSave,
        title: label,
        'aria-label': label,
        onMousedown: (event: MouseEvent) => event.preventDefault(),
        onClick: () => onSave?.(),
      },
      // Save is icon-shaped in the registry; `?? []` is the type-level guard, not a
      // real case (a pathless save would render an empty button).
      [icon(c.paths ?? [])]
    );
  }

  // A stepper-shaped control this toolbar cannot drive (zoom, font size) renders as the
  // disabled minus / boxed value / plus lookalike, showing the registry's valueText.
  if (c.shape === 'stepper' && !isDrivenHere(c)) {
    return h(
      'span',
      {
        key: c.id,
        class: 'ep-toolbar__stepper',
        'data-testid': `toolbar-${slotId}`,
        'aria-disabled': 'true',
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      },
      [
        h('span', { class: 'ep-toolbar__stepper-button', 'aria-hidden': 'true' }, '−'),
        h('span', { class: 'ep-toolbar__stepper-value' }, c.valueText ?? ''),
        h('span', { class: 'ep-toolbar__stepper-button', 'aria-hidden': 'true' }, '+'),
        h('span', { class: 'ep-sr-only' }, `${label} — ${t(CHROME_UNAVAILABLE_KEY)}`),
      ]
    );
  }

  // A dropdown-shaped control this toolbar cannot drive renders as a disabled
  // combobox-lookalike, matching its registry shape: optional leading glyph (line
  // spacing, editing mode), optional value text, caret. Test ids are keyed on the SLOT
  // id (`toolbar-text.bold`): control ids are only unique within their group
  // (`image.insert` / `table.insert`), so a bare control id would collide.
  if (c.paths === null || (c.shape === 'dropdown' && !isDrivenHere(c))) {
    const value = c.valueKey ? t(c.valueKey) : (c.valueText ?? '');
    return h(
      'span',
      {
        key: c.id,
        class: 'ep-toolbar__picker',
        'data-testid': `toolbar-${slotId}`,
        'aria-disabled': 'true',
        // A picker is a <span>, so it does not take focus itself, but a mousedown
        // still blurs the editor. Same reasoning as the disabled buttons above.
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      },
      [
        ...(c.paths ? [icon(c.paths)] : []),
        ...(value ? [h('span', { class: 'ep-toolbar__picker-value' }, value)] : []),
        h('span', { class: 'ep-toolbar__picker-caret', 'aria-hidden': 'true' }, '▾'),
        h('span', { class: 'ep-sr-only' }, `${label} — ${t(CHROME_UNAVAILABLE_KEY)}`),
      ]
    );
  }

  // What is left that this toolbar cannot drive is the colour splits: value slots whose
  // shape carries an icon, so they keep the icon-button look rather than becoming a
  // combobox. Disabled because THIS toolbar has no colour picker — the engine would
  // honour a colour today (React's split buttons dispatch one), which is why the reason
  // is the adapter's "unavailable" string and not an engine refusal.
  if (!isDrivenHere(c)) {
    const reason = `${label} — ${t(CHROME_UNAVAILABLE_KEY)}`;
    return h(
      'button',
      {
        key: c.id,
        type: 'button',
        class: 'ep-toolbar__button',
        'data-testid': `toolbar-${slotId}`,
        // Kept under its original name: hosts style off it, and it still marks exactly
        // what it always marked — present for parity, not driven by this toolbar.
        'data-parity-only': 'true',
        disabled: true,
        title: reason,
        'aria-label': reason,
        // Even a DISABLED control must not steal focus. Round-5 review measured every
        // undriven control moving `document.activeElement` to BODY, dropping
        // `frame.focus.focused`, un-painting the caret, and leaving all six geometry
        // keys refused — in both adapters. Clicking a visible disabled button cost the
        // user their caret and their keyboard.
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      },
      [icon(c.paths)]
    );
  }

  // The command comes from the SLOT id through `commandForSlot` inside the shared
  // helpers — one command table for both adapters. `active` is `Editor.isActive`,
  // derived in the engine for marks/alignment, surfaced as `aria-pressed` so the
  // control reflects live editor state.
  const state = toolbarCommandState(editor, slotId);
  return h(
    'button',
    {
      key: c.id,
      type: 'button',
      class: 'ep-toolbar__button',
      'data-testid': `toolbar-${slotId}`,
      disabled: !state.enabled,
      'aria-pressed': state.active ? 'true' : 'false',
      // The engine's own words, never an adapter paraphrase.
      title: state.disabledReason ?? label,
      'aria-label': label,
      onMousedown: (event: MouseEvent) => event.preventDefault(), // keep focus on the editor
      onClick: () => runToolbarCommand(editor, slotId),
    },
    [icon(c.paths)]
  );
}

const ALIGNMENT_SLOTS: readonly ChromeSlotId[] = [
  'alignment.left',
  'alignment.center',
  'alignment.right',
  'alignment.justify',
];

/**
 * The merged alignment control: the chrome spec renders the four alignment slots
 * as ONE dropdown (current alignment's icon + caret opening a four-option row), and
 * both adapters merge the group the same way. Wired through the same shared
 * can-before-exec helpers as every other control.
 */
const AlignmentDropdown = defineComponent({
  name: 'DocxEditorToolbarAlignment',
  props: {
    editor: { type: Object as PropType<Editor | null>, default: null },
    t: { type: Function as PropType<Translate>, required: true },
    controls: { type: Array as PropType<readonly ChromeControl[]>, required: true },
  },
  setup(props) {
    const open = ref(false);
    return () => {
      const options = ALIGNMENT_SLOTS.map((slot, index) => ({
        slot,
        control: props.controls[index]!,
        state: toolbarCommandState(props.editor, slot),
      }));
      const current = options.find((option) => option.state.active) ?? options[0]!;
      const enabled = options.some((option) => option.state.enabled);
      const currentLabel = props.t(current.control.labelKey);
      return h('span', { class: 'ep-toolbar__alignment', 'data-testid': 'toolbar-alignment' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'ep-toolbar__button ep-toolbar__alignment-trigger',
            disabled: !enabled,
            'aria-haspopup': 'true',
            'aria-expanded': open.value ? 'true' : 'false',
            'aria-label': currentLabel,
            title: enabled ? currentLabel : (current.state.disabledReason ?? currentLabel),
            onMousedown: (event: MouseEvent) => event.preventDefault(),
            onClick: () => {
              open.value = !open.value;
            },
          },
          [
            icon(current.control.paths ?? []),
            h('span', { class: 'ep-toolbar__picker-caret', 'aria-hidden': 'true' }, '▾'),
          ]
        ),
        open.value
          ? h(
              'div',
              { class: 'ep-toolbar__alignment-popup' },
              options.map((option) =>
                h(
                  'button',
                  {
                    key: option.slot,
                    type: 'button',
                    class: 'ep-toolbar__button',
                    'data-testid': `toolbar-${option.slot}`,
                    disabled: !option.state.enabled,
                    'aria-pressed': option.state.active ? 'true' : 'false',
                    title: option.state.disabledReason ?? props.t(option.control.labelKey),
                    'aria-label': props.t(option.control.labelKey),
                    onMousedown: (event: MouseEvent) => event.preventDefault(),
                    onClick: () => {
                      runToolbarCommand(props.editor, option.slot);
                      open.value = false;
                    },
                  },
                  [icon(option.control.paths ?? [])]
                )
              )
            )
          : null,
      ]);
    };
  },
});

export default defineComponent({
  name: 'DocxEditorToolbar',
  props: {
    editor: { type: Object as PropType<Editor | null>, default: null },
    t: { type: Function as PropType<Translate>, required: true },
    onSave: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props) {
    // Re-render as the selection and document change, or `can()` answers go stale.
    //
    // `revision.value` MUST be read inside the render closure. Discarding the ref
    // gives Vue no reactive dependency, and the rewrite that introduced this file
    // dropped the `computed(() => { void revision.value; ... })` the previous version
    // had. Round-5 review proved the consequence by differential: patch `Editor.can`
    // to refuse, fire one event, and React's controls correctly become disabled with
    // the engine's reason while Vue's stayed enabled with their original titles —
    // a permanently stale toolbar, invisible to all five parity gates. React works
    // regardless because `setRevision` re-renders unconditionally; Vue does not.
    const revision = useEditorSnapshot(() => props.editor);
    return () => {
      void revision.value;
      return h(
        'div',
        {
          class: 'ep-toolbar',
          role: 'toolbar',
          'aria-label': props.t('toolbar.ariaLabel'),
          'data-testid': 'docx-editor-toolbar',
          // Focus protection on the CONTAINER — see the React counterpart. A disabled
          // form control never receives mousedown in Chromium, so a per-button handler
          // is dead code, and `pointer-events: none` just moves the blur here.
          onMousedown: (event: MouseEvent) => event.preventDefault(),
        },
        // The DEFAULT arrangement is the registry's default bar: contextual groups
        // (image / table / save) are composition-only, and the alignment group
        // renders as ONE merged dropdown — same rules as the React toolbar.
        defaultChromeGroups().map((group, index) =>
          h('div', { key: group.id, class: 'ep-toolbar__group-wrap' }, [
            ...(index > 0 ? [h('div', { class: 'ep-toolbar__separator', role: 'separator' })] : []),
            h(
              'div',
              {
                class: 'ep-toolbar__group',
                role: 'group',
                'aria-label': props.t(group.labelKey),
                'data-group': group.id,
              },
              group.id === 'alignment'
                ? [
                    h(AlignmentDropdown, {
                      editor: props.editor,
                      t: props.t,
                      controls: group.controls,
                    }),
                  ]
                : group.controls.map((c) =>
                    control(props.editor, chromeSlotId(group, c), c, props.t, props.onSave)
                  )
            ),
          ])
        )
      );
    };
  },
});
