/**
 * Bidi Shortcut Extension — Ctrl/Cmd+Left Shift → LTR, Ctrl/Cmd+Right Shift → RTL
 *
 * Uses KeyboardEvent.code to distinguish ShiftLeft vs ShiftRight,
 * matching the standard Google Docs shortcut behavior.
 *
 * Priority: High (50) — should intercept before other keymaps
 */

import { Plugin } from 'prosemirror-state';
import { createExtension } from '../create';
import { Priority } from '../types';
import type { ExtensionRuntime, ExtensionContext } from '../types';
import { singletonManager } from '../../schema';

export const BidiShortcutExtension = createExtension({
  name: 'bidiShortcut',
  priority: Priority.High,
  onSchemaReady(_ctx: ExtensionContext): ExtensionRuntime {
    return {
      plugins: [
        new Plugin({
          props: {
            handleKeyDown(view, event) {
              // Only trigger on Shift key press while Ctrl (Win/Linux) or Cmd (Mac) is held
              if (event.key !== 'Shift') return false;
              const isMod = event.metaKey || event.ctrlKey;
              if (!isMod) return false;

              const cmds = singletonManager.getCommands();

              if (event.code === 'ShiftLeft') {
                event.preventDefault();
                cmds.setLtr()(view.state, view.dispatch);
                return true;
              }
              if (event.code === 'ShiftRight') {
                event.preventDefault();
                cmds.setRtl()(view.state, view.dispatch);
                return true;
              }
              return false;
            },
          },
        }),
      ],
    };
  },
});
