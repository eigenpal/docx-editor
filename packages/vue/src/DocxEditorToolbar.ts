// Toolbar (interactive-paginated-editing M5.1, extended to full legacy parity at M6V.1).
//
// The Vue counterpart of React's `DocxEditorToolbar.tsx`, sharing the engine's
// can-before-exec wiring so the two toolbars cannot drift on when a control is
// enabled. Every control's enabled state is one `Editor.can(command)` answer; a
// click runs `Editor.exec(command)` only after `can` said yes; save calls
// `Editor.save()` directly. A control the engine cannot honour renders disabled
// with the engine's own reason as its tooltip.
//
// Groups, ordering, icons, and i18n keys come from `LEGACY_CHROME_GROUPS` in
// engine-editor — the same data React renders, so the two cannot diverge on the
// chrome itself either. Two divergences this file previously carried are fixed
// here: it defaulted `showSave` to true where React rendered save only when a
// handler was supplied, and it hardcoded English labels.

import { defineComponent, h, type PropType, type VNode } from 'vue';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import {
  LEGACY_CHROME_GROUPS,
  LEGACY_CHROME_UNAVAILABLE_KEY,
  runToolbarCommand,
  toolbarCommandState,
  type LegacyChromeControl,
} from '@docx-editor.dev/engine-editor';
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
    { viewBox: '0 -960 960 960', width: '18', height: '18', 'aria-hidden': 'true', focusable: 'false' },
    paths.map((d) => h('path', { key: d, d, fill: 'currentColor' })),
  );
}

function control(
  editor: Editor | null,
  c: LegacyChromeControl,
  t: Translate,
  onSave: (() => void) | undefined,
): VNode {
  const label = t(c.labelKey);

  // A picker renders as a disabled combobox, matching its legacy shape.
  if (c.paths === null) {
    return h(
      'span',
      {
        key: c.id,
        class: 'ep-toolbar__picker',
        'data-testid': `toolbar-${c.id}`,
        'aria-disabled': 'true',
        // A picker is a <span>, so it does not take focus itself, but a mousedown
        // still blurs the editor. Same reasoning as the disabled buttons above.
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      },
      [
        h('span', { class: 'ep-toolbar__picker-value' }, c.valueKey ? t(c.valueKey) : ''),
        h('span', { class: 'ep-toolbar__picker-caret', 'aria-hidden': 'true' }, '▾'),
        h('span', { class: 'ep-sr-only' }, `${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`),
      ],
    );
  }

  if (c.state.kind === 'parityOnly') {
    const reason = `${label} — ${t(LEGACY_CHROME_UNAVAILABLE_KEY)}`;
    return h(
      'button',
      {
        key: c.id,
        type: 'button',
        class: 'ep-toolbar__button',
        'data-testid': `toolbar-${c.id}`,
        'data-parity-only': 'true',
        disabled: true,
        title: reason,
        'aria-label': reason,
        // Even a DISABLED control must not steal focus. Round-5 review measured all
        // 24 parity-only controls moving `document.activeElement` to BODY, dropping
        // `frame.focus.focused`, un-painting the caret, and leaving all six geometry
        // keys refused — 24/24 in both adapters. Clicking the visible Underline
        // button cost the user their caret and their keyboard.
        onMousedown: (event: MouseEvent) => event.preventDefault(),
      },
      [icon(c.paths)],
    );
  }

  if (c.state.kind === 'save') {
    return h(
      'button',
      {
        key: c.id,
        type: 'button',
        class: 'ep-toolbar__button',
        'data-testid': `toolbar-${c.id}`,
        disabled: !editor || !onSave,
        title: label,
        'aria-label': label,
        onMousedown: (event: MouseEvent) => event.preventDefault(),
        onClick: () => onSave?.(),
      },
      [icon(c.paths)],
    );
  }

  const commandId = c.state.command;
  const state = toolbarCommandState(editor, commandId);
  // No active/pressed state.
  //
  // A toolbar should show whether bold is currently ON, and the repo's own guidance
  // says controls must reflect live editor state rather than being static. It is
  // omitted here because `CanResult` is `{ ok } | { ok, code, reason }` — the public
  // contract can answer "may this run?" but not "is it currently applied?".
  // Surfacing it needs a new public query, and M6V.1 is explicitly a visual-shell
  // gate that must not widen the feature surface. Tracked as a known gap.
  return h(
    'button',
    {
      key: c.id,
      type: 'button',
      class: 'ep-toolbar__button',
      'data-testid': `toolbar-${c.id}`,
      disabled: !state.enabled,
      // The engine's own words, never an adapter paraphrase.
      title: state.disabledReason ?? label,
      'aria-label': label,
      onMousedown: (event: MouseEvent) => event.preventDefault(), // keep focus on the editor
      onClick: () => runToolbarCommand(editor, commandId),
    },
    [icon(c.paths)],
  );
}

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
        },
        LEGACY_CHROME_GROUPS.map((group, index) =>
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
              group.controls.map((c) => control(props.editor, c, props.t, props.onSave)),
            ),
          ]),
        ),
      );
    };
  },
});
