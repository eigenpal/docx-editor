'use client';

// docx-editor + @docx-editor.dev/pro in the Next.js App Router.
//
// The tier-2 sugar `<DocxEditor>` renders the full packaged chrome — title bar,
// menu, toolbar, navigation pane. Prefer the composition tree
// (`DocxEditor.Root` / `.Toolbar` / `.Viewport` / `.Content`, see examples/vite
// and examples/igloo) when you want to own the layout; the sugar is the
// drop-in. Two lines make it pro: `modules` registers the review capability
// (comments, tracked changes, suggesting mode), and the review pane from
// `@docx-editor.dev/pro/react` mounts as a viewport child. Remove both and the
// same document still opens — revisions render in their final state and the
// review controls disable with the engine's own reason.

import { useMemo, useState } from 'react';
import { DocxEditor } from '@docx-editor.dev/react';
import { reviewModule } from '@docx-editor.dev/pro';
import { DocxEditorReview } from '@docx-editor.dev/pro/react';
import { emptyDocx } from '../../../shared/demoDocument';
import { ExampleSwitcher } from '../../../shared/ExampleSwitcher';
import { GitHubBadge } from '../../../shared/GitHubBadge';

// One stable array: module registration is construction-time, like `author`.
const PRO_MODULES = [reviewModule()];

export function Editor() {
  const [title, setTitle] = useState('Untitled document');
  const documentBytes = useMemo(() => emptyDocx(), []);
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Host chrome stays HOST composition — nothing threads through the editor. */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
        }}
      >
        <GitHubBadge />
        <ExampleSwitcher current="Next.js" />
      </header>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <DocxEditor
          document={documentBytes}
          author="Demo Reviewer"
          modules={PRO_MODULES}
          title={title}
          onTitleChange={setTitle}
          onReady={(editor) => {
            // The editor arrives MOUNTED: `onReady` fires after the pages have
            // painted, so commands and reads work right here — no second
            // "view ready" callback to wait for.
            console.info('[docx-editor] pages painted:', editor.snapshot().page.total);
          }}
        >
          <DocxEditorReview />
        </DocxEditor>
      </div>
    </div>
  );
}
