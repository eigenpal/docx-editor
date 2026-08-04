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

import { useState } from 'react';
import { DocxEditor, useDocxSource } from '@docx-editor.dev/react';
import { defaultFonts } from '@docx-editor.dev/fonts';
import { IceSea } from './art/IceSea';
import { Iceberg } from './art/Iceberg';
import { IglooContextMenu } from './IglooContextMenu';
import { IglooMenu } from './IglooMenu';
import { IglooToolbar } from './IglooToolbar';
import { Blizzard } from './art/Blizzard';
import { iglooT } from './labels';

export interface IglooEditorProps {
  /** Same-origin DOCX to open. */
  readonly fixtureUrl: string;
}

export function IglooEditor({ fixtureUrl }: IglooEditorProps) {
  const [blizzard, setBlizzard] = useState(false);

  // The whole boot: fetch the bytes, load Word's default faces, register them for paint,
  // compose the configuration, and cancel both if this unmounts. `defaultFonts` is passed
  // rather than imported by the hook, so a host bringing its own faces — or none — does not
  // ship the default font bytes.
  const { document: bytes, fonts, error } = useDocxSource(fixtureUrl, { fonts: defaultFonts });

  return (
    <div className="ep-root igloo-shell">
      {/* The sea, behind everything and not scrolling with the page. */}
      <IceSea />
      {blizzard ? <Blizzard /> : null}

      <DocxEditor.Root
        {...(bytes ? { document: bytes } : {})}
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
          {/* COMPOSED, not just re-themed. The pane's parts are statics, so the demo can
              hang its OWN class on each one rather than styling the library's internals —
              which is the difference between customizing the API and working around it. The
              parts still do all the work: the headings list is still `Navigation.Headings`,
              still fed by the engine's outline. */}
          <DocxEditor.Navigation
            className="igloo-nav"
            t={iglooT}
            toggle={{ className: 'igloo-nav__toggle' }}
          >
            <DocxEditor.Navigation.Header className="igloo-nav__header">
              <DocxEditor.Navigation.Close className="igloo-nav__close" />
              <DocxEditor.Navigation.Title className="igloo-nav__title" />
            </DocxEditor.Navigation.Header>
            <DocxEditor.Navigation.Tabs className="igloo-nav__tabs" />
            <DocxEditor.Navigation.Headings className="igloo-nav__headings" />
            <DocxEditor.Navigation.Find className="igloo-nav__find" />
          </DocxEditor.Navigation>

          <DocxEditor.Viewport className="igloo-viewport">
            {/* The vertical ruler sits at the EDITING AREA's left edge, where Word and Docs
                put it — not beside the page. It rides inside the scroll container as an
                absolutely positioned child, so it scrolls with the document and its zero
                stays on the first page's top edge; that offset is the stage's own top
                padding, and the two have to agree or the inch marks describe a page they are
                not level with. */}
            <div className="igloo-vrulerbar" aria-hidden="true">
              <DocxEditor.VerticalRuler className="igloo-ruler" />
            </div>

            {/* The loading screen, replaced: rendered only while there is no document. */}
            <DocxEditor.Loading>
              <div className="igloo-loading">
                <IglooMark spinning />
                <span>{error ? error.message : 'Carving the berg…'}</span>
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
