import { CHROME_GROUPS, chromeSlotId, toolbarCommandState } from '@docx-editor.dev/core/editor';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { zipSync, strToU8 } from 'fflate';
import { stepZoomLevel } from '../../react/src/editor/zoom-levels.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export function differentialDocx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

export const DIFFERENTIAL_SOURCE = differentialDocx(
  '<w:p><w:r><w:t>parity differential</w:t></w:r></w:p>'
);

export const DIFFERENTIAL_SLOTS = CHROME_GROUPS.flatMap((group) =>
  group.controls.map((control) => chromeSlotId(group, control))
);

export const OFF_LADDER_ZOOM = 0.73;

export function offLadderZoomIn(): number | null {
  return stepZoomLevel(OFF_LADDER_ZOOM, 'in');
}

export type ComposableParityCase =
  | {
      readonly id: string;
      readonly composable: 'useEditorCommand';
      readonly slot: ChromeSlotId;
      readonly assert: (
        binding: {
          isEnabled: boolean;
          isActive: boolean;
          disabledReason: string | null;
        },
        editor: DocxEditorInstance
      ) => void;
    }
  | {
      readonly id: string;
      readonly composable: 'useZoom';
      readonly assert: (editor: DocxEditorInstance, stepIn: number | null) => void;
    }
  | {
      readonly id: string;
      readonly composable: 'useDocumentSearch';
      readonly assert: (limit: number) => void;
    }
  | {
      readonly id: string;
      readonly composable: 'usePageSetup';
      readonly assert: (editor: DocxEditorInstance) => void;
    };

export const COMPOSABLE_PARITY_CASES: readonly ComposableParityCase[] = [
  ...DIFFERENTIAL_SLOTS.map(
    (slot): ComposableParityCase => ({
      id: `useEditorCommand:${slot}`,
      composable: 'useEditorCommand',
      slot,
      assert(binding, editor) {
        const engine = toolbarCommandState(editor, slot);
        if (binding.isEnabled !== engine.enabled) {
          throw new Error(`enabled mismatch for ${slot}`);
        }
        if (binding.isActive !== engine.active) {
          throw new Error(`active mismatch for ${slot}`);
        }
        if ((binding.disabledReason ?? null) !== (engine.disabledReason ?? null)) {
          throw new Error(`disabledReason mismatch for ${slot}`);
        }
      },
    })
  ),
  {
    id: 'useZoom:offLadder',
    composable: 'useZoom',
    assert(editor, stepIn) {
      editor.setZoom(OFF_LADDER_ZOOM);
      editor.setZoom(stepIn ?? OFF_LADDER_ZOOM);
      if (editor.snapshot().zoom !== stepIn) {
        throw new Error('off-ladder zoom step mismatch');
      }
    },
  },
  {
    id: 'useDocumentSearch:cap',
    composable: 'useDocumentSearch',
    assert(limit) {
      if (!(limit > 0)) throw new Error('search cap must be positive');
    },
  },
  {
    id: 'usePageSetup:undo',
    composable: 'usePageSetup',
    assert(editor) {
      const beforeWidth = editor.getPageSetup()!.pageWidthTwips;
      editor.exec({ type: 'setPageSetup', pageWidth: beforeWidth + 144 });
      if (editor.getPageSetup()!.pageWidthTwips !== beforeWidth + 144) {
        throw new Error('page setup write did not apply');
      }
      editor.exec({ type: 'undo' });
      if (editor.getPageSetup()!.pageWidthTwips !== beforeWidth) {
        throw new Error('page setup undo did not restore width');
      }
    },
  },
];
