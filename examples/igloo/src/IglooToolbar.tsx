// The toolbar, arranged by hand and drawn in the demo's own icons.
//
// `preset={false}` opts out of the registry's default arrangement entirely, so the ORDER
// here is the order on screen. That is the heavier of the two customization paths — the
// lighter one is dropping a single part in and letting everything else stay — and it is
// the one worth showing, because it is what a product with an opinion about its own toolbar
// actually does.
//
// Every packaged part still drives its chrome slot: the enabled state, the pressed state
// and the command all still come from the engine. Only the glyph is the demo's.

import { DocxEditor } from '@docx-editor.dev/react';
import { useFrost } from './useFrost';
import { iglooT } from './labels';
import {
  IceAlignCenter,
  IceAlignLeft,
  IceAlignRight,
  IceBlizzard,
  IceBold,
  IceBullets,
  IceClear,
  IceCoreRail,
  IceFontColor,
  IceFreeze,
  IceHighlight,
  IceItalic,
  IceLink,
  IceNumbers,
  IceRedo,
  IceStrike,
  IceUndo,
  IceUnderline,
} from './icons/toolbar';

/** The two demo-owned actions, side by side, are the point of this pair. */
interface IglooActionsProps {
  /** Whether the decorative blizzard is running. Host state, nothing to do with the engine. */
  readonly blizzard: boolean;
  readonly onBlizzard: () => void;
}

/**
 * Freeze — a host `Action` whose ENABLED STATE comes from the engine.
 *
 * No chrome slot names it, so the label, the glyph and the effect are the demo's. What is
 * not the demo's is whether it may run: that is asked of `Editor.can` on the very command
 * `onSelect` will exec, so the button cannot offer an action the engine is about to refuse,
 * and the tooltip carries the engine's words rather than a guess.
 */
function FreezeAction() {
  const { freeze, enabled, disabledReason } = useFrost();
  return (
    <DocxEditor.Toolbar.Action
      label="Freeze this passage"
      icon={IceFreeze}
      disabled={!enabled}
      {...(disabledReason ? { disabledReason } : {})}
      onSelect={freeze}
    />
  );
}

export function IglooToolbar({ blizzard, onBlizzard }: IglooActionsProps) {
  return (
    <DocxEditor.Toolbar preset={false} className="igloo-toolbar" t={iglooT}>
      <DocxEditor.Toolbar.Undo icon={IceUndo} />
      <DocxEditor.Toolbar.Redo icon={IceRedo} />
      <DocxEditor.Toolbar.Separator />

      {/* The compound pickers, kept whole. A host that only wants a different LOOK should
          not have to rebuild the picker's behaviour, and here it does not: these are the
          packaged components, restyled from the stylesheet. */}
      <DocxEditor.Toolbar.StylePicker className="igloo-picker" />
      <DocxEditor.Toolbar.FontFamily className="igloo-picker" />
      <DocxEditor.Toolbar.FontSize />
      <DocxEditor.Toolbar.Separator />

      <DocxEditor.Toolbar.Bold icon={IceBold} />
      <DocxEditor.Toolbar.Italic icon={IceItalic} />
      <DocxEditor.Toolbar.Underline icon={IceUnderline} />
      <DocxEditor.Toolbar.Strike icon={IceStrike} />
      {/* Only the GLYPH is the demo's. The colour bar under each is the library's and
          still paints the live value, so the control stays readable at a glance. */}
      <DocxEditor.Toolbar.FontColor icon={IceFontColor} />
      <DocxEditor.Toolbar.Highlight icon={IceHighlight} />
      <DocxEditor.Toolbar.Separator />

      <DocxEditor.Toolbar.AlignLeft icon={IceAlignLeft} />
      <DocxEditor.Toolbar.AlignCenter icon={IceAlignCenter} />
      <DocxEditor.Toolbar.AlignRight icon={IceAlignRight} />
      <DocxEditor.Toolbar.BulletList icon={IceBullets} />
      <DocxEditor.Toolbar.NumberedList icon={IceNumbers} />
      <DocxEditor.Toolbar.Separator />

      <DocxEditor.Toolbar.Link icon={IceLink} />
      <DocxEditor.Toolbar.ClearFormatting icon={IceClear} />
      <DocxEditor.Toolbar.Separator />

      {/* The rail toggle. A PACKAGED part on the `review.comments` slot, so its pressed state
          is the engine's answer to "is the pane open" rather than a flag this file keeps —
          which matters because the pane is also opened by clicking a marker and by starting
          a comment, and a host-held boolean would be a third opinion about it. Only the
          glyph is the demo's; `data-active` is what the theme styles. */}
      <DocxEditor.Toolbar.Comments icon={IceCoreRail} />
      <DocxEditor.Toolbar.Separator />

      {/* THE DEMO'S OWN, and marked as such.
          Two host actions with nothing else in common, which is why they are here together:
          one reaches into the engine, one never touches it. Both render as first-class
          toolbar controls, with the same hover, pressed and caret-guard behaviour as the
          packaged buttons — which is the reason `Action` exists rather than a documented
          class name.

          The tinted plate around them is this file's own element, not a library one: with a
          hand-ordered bar there is nothing to tell a reader which buttons came from the
          engine's chrome registry and which the product added, and on a demo about exactly
          that distinction it should not be a guess. A plain `div` composes here because
          `preset={false}` renders these children verbatim into a flex row. */}
      <div className="igloo-own" role="group" aria-label="Added by Igloo Editor">
        <FreezeAction />
        <DocxEditor.Toolbar.Action
          label="Blizzard"
          icon={IceBlizzard}
          active={blizzard}
          onSelect={onBlizzard}
        />
      </div>

      <div className="igloo-toolbar__spacer" />

      {/* Editing / Suggesting / Viewing — the PACKAGED pill, not a demo reimplementation.
          Suggesting is what makes this theme's tracked-change colours appear at all: typing
          writes `w:ins`, deleting writes `w:del`, and every edit lands in the review rail as
          a proposal. Restyled by class; the modes, the radio semantics, the keyboard menu
          and the engine's refusal on a read-only document are all the library's. */}
      <DocxEditor.Toolbar.EditingMode className="igloo-mode" />
      <DocxEditor.Toolbar.Zoom />
    </DocxEditor.Toolbar>
  );
}
