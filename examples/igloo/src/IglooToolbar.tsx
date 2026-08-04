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
import { useFrost } from './frost';
import { iglooT } from './labels';
import {
  IceAlignCenter,
  IceAlignLeft,
  IceAlignRight,
  IceBlizzard,
  IceBold,
  IceBullets,
  IceClear,
  IceFreeze,
  IceItalic,
  IceLink,
  IceNumbers,
  IceRedo,
  IceStrike,
  IceUndo,
  IceUnderline,
} from './icons';

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
      <DocxEditor.Toolbar.FontColor />
      <DocxEditor.Toolbar.Highlight />
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

      {/* Two host actions with nothing else in common, which is why they are here together:
          one reaches into the engine, one never touches it. Both render as first-class
          toolbar controls, with the same hover, pressed and caret-guard behaviour as the
          packaged buttons — which is the reason `Action` exists rather than a documented
          class name. */}
      <FreezeAction />
      <DocxEditor.Toolbar.Action
        label="Blizzard"
        icon={IceBlizzard}
        active={blizzard}
        onSelect={onBlizzard}
      />

      <div className="igloo-toolbar__spacer" />
      <DocxEditor.Toolbar.Zoom />
    </DocxEditor.Toolbar>
  );
}
