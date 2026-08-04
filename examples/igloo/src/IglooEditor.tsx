// Igloo Editor: the whole customization surface, themed as ice.
//
// Everything on screen is composed under `<DocxEditor.Root>` — the library's own primitives
// and compounds, plus arbitrary React of the demo's own — so the file reads as the answer to
// "how much of this is mine?" The answer is: the arrangement, the icons, the labels, the
// colours and the art; the engine, the rows, the pickers and every enabled state are the
// library's, and none of them had to be reimplemented to be re-skinned.
//
// The DOCUMENT CANVAS is deliberately NOT themed. Painter output stays Word-faithful — a
// page that looked like ice would be a lie about what the file contains — so the theme lives
// in the chrome, in the sea behind, and in the berg the page rides on.

import { useEffect, useRef, useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import type { FontConfiguration } from '@docx-editor.dev/react';
import { composeFontConfiguration } from '@docx-editor.dev/react';
import { installDefaultFontFaces, loadDefaultFonts } from '@docx-editor.dev/fonts';
import { IceSea } from './IceSea';
import { Iceberg } from './Iceberg';
import { IglooContextMenu } from './IglooContextMenu';
import { IglooMenu } from './IglooMenu';
import { IglooToolbar } from './IglooToolbar';
import { Blizzard } from './Blizzard';
import { iglooT } from './labels';

export interface IglooEditorProps {
  /** Same-origin DOCX to open. */
  readonly fixtureUrl: string;
}

export function IglooEditor({ fixtureUrl }: IglooEditorProps) {
  const [document_, setDocument] = useState<Uint8Array | null>(null);
  const [fonts, setFonts] = useState<FontConfiguration | null>(null);
  const [blizzard, setBlizzard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fonts first, then bytes. Both are same-origin reads started by the page load — no
  // remote target from the file is ever fetched.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const fragment = await loadDefaultFonts();
        // Degradations are diagnosable, not silent: a face that failed falls back to
        // fixed-width measurement for that family only.
        for (const failure of fragment.failures) {
          console.warn(`[fonts] ${failure.family} (${failure.file}): ${failure.diagnostic}`);
        }
        // Paint-side twin: registers the substitutes under the Word family names, so painted
        // glyphs use the metrics layout measured with.
        void installDefaultFontFaces();
        if (live) setFonts(composeFontConfiguration(fragment));
      } catch {
        // A font failure is not a document failure: the engine substitutes and paints.
      }
      try {
        const response = await fetch(fixtureUrl);
        if (!response.ok) throw new Error(`${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (live) setDocument(bytes);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : 'could not open the document');
      }
    })();
    return () => {
      live = false;
    };
  }, [fixtureUrl]);

  return (
    <div className="ep-root igloo-shell">
      {/* The sea, behind everything and not scrolling with the page. */}
      <IceSea />
      {blizzard ? <Blizzard /> : null}

      <DocxEditor.Root
        {...(document_ ? { document: document_ } : {})}
        {...(fonts ? { fonts } : {})}
        author="Igloo"
      >
        <div className="igloo-chrome">
          <header className="igloo-brand">
            <IglooMark />
            <div className="igloo-brand__text">
              <h1>Igloo Editor</h1>
              <p>Same editor. Colder.</p>
            </div>
          </header>
          <IglooMenu />
          <IglooToolbar blizzard={blizzard} onBlizzard={() => setBlizzard((on) => !on)} />
        </div>

        {/* The rulers, context-fed: they read page setup from the editor and commit margin
            drags back to it. Restyled as icicle ticks, not reimplemented. */}
        <div className="igloo-rulerbar">
          <DocxEditor.HorizontalRuler className="igloo-ruler" />
        </div>

        {/* The navigation pane is a SIBLING of the viewport inside a positioned row, not a
            column beside it — the same shape the packaged component uses. The pane floats
            over the gutter and absolutely positions against this box, so without the
            positioning context it would lay out in the flow and push the page down. */}
        <div className="igloo-workspace">
          <DocxEditor.Navigation className="igloo-nav" t={iglooT} />

          <DocxEditor.Viewport className="igloo-viewport">
            {/* The loading screen, replaced: rendered only while there is no document. */}
            <DocxEditor.Loading>
              <div className="igloo-loading">
                <IglooMark spinning />
                <span>{error ? `Could not open the document: ${error}` : 'Carving the berg…'}</span>
              </div>
            </DocxEditor.Loading>

            {/* The berg the page rides on: art behind, page on top, both in one stage so the
                berg tracks the page as it scrolls. */}
            <div className="igloo-stage">
              <Iceberg />
              <DocxEditor.Content className="igloo-page" />
            </div>

            {/* The packaged link popover, restyled into an ice shard by class alone. */}
            <DocxEditor.HyperLink className="igloo-shard" />
            <IglooContextMenu />
          </DocxEditor.Viewport>
        </div>
      </DocxEditor.Root>
    </div>
  );
}

/** The demo's mark: a small berg, reused in the header and the loading screen. */
function IglooMark({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      className={`igloo-mark${spinning ? ' igloo-mark--spin' : ''}`}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 30 14 14l6 5 5-11 7 12 4-3 6 13z" fill="#e8f8ff" />
      <path d="M25 8l7 12-7 10-8-11z" fill="#ffffff" opacity="0.85" />
      <path d="M4 30h40l-6 10H10z" fill="#7fc4e4" opacity="0.75" />
    </svg>
  );
}
